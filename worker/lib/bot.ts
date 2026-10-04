import type { Env } from '../env'
import { github, GitHubError } from './github'

// Pull requests from a fork of the bot (spec 7.2): the bot needs no
// permission on the author's repository, so the portal can never push code
// there. The author merges.

export interface BotFile {
  path: string
  content: string | Uint8Array
}

export interface BotPullRequest {
  repo: string
  branch: string
  base?: string
  title: string
  body: string
  message: string
  files: BotFile[]
}

export function botEnabled(env: Env): boolean {
  return !!env.BOT_TOKEN && !!env.BOT_LOGIN
}

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function forkOf(env: Env, repo: string): Promise<string> {
  const token = env.BOT_TOKEN!
  const fork = await github<{ full_name: string }>(`/repos/${repo}/forks`, token, json({ default_branch_only: true }))
  // Forking is asynchronous; the fork answers once its git data exists.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await github(`/repos/${fork.full_name}/git/ref/heads`, token)
      return fork.full_name
    }
    catch (error) {
      if (!(error instanceof GitHubError) || (error.status !== 404 && error.status !== 409))
        throw error
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  return fork.full_name
}

/** Opens or updates the bot's pull request; returns its number and URL. */
export async function openBotPullRequest(env: Env, pr: BotPullRequest): Promise<{ number: number, url: string }> {
  const token = env.BOT_TOKEN!
  const upstream = await github<{ default_branch: string }>(`/repos/${pr.repo}`, token)
  const base = pr.base ?? upstream.default_branch
  const fork = await forkOf(env, pr.repo)
  const head = await github<{ object: { sha: string } }>(`/repos/${pr.repo}/git/ref/heads/${encodeURIComponent(base)}`, token)
  const parent = await github<{ tree: { sha: string } }>(`/repos/${pr.repo}/git/commits/${head.object.sha}`, token)
  const tree = []
  for (const file of pr.files) {
    const blob = typeof file.content === 'string'
      ? await github<{ sha: string }>(`/repos/${fork}/git/blobs`, token, json({ content: file.content, encoding: 'utf-8' }))
      : await github<{ sha: string }>(`/repos/${fork}/git/blobs`, token, json({ content: base64(file.content), encoding: 'base64' }))
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const newTree = await github<{ sha: string }>(`/repos/${fork}/git/trees`, token, json({ base_tree: parent.tree.sha, tree }))
  const commit = await github<{ sha: string }>(`/repos/${fork}/git/commits`, token, json({ message: pr.message, tree: newTree.sha, parents: [head.object.sha] }))
  try {
    await github(`/repos/${fork}/git/refs/heads/${encodeURIComponent(pr.branch)}`, token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: commit.sha, force: true }) })
  }
  catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 422)
      throw error
    await github(`/repos/${fork}/git/refs`, token, json({ ref: `refs/heads/${pr.branch}`, sha: commit.sha }))
  }
  const owner = fork.split('/')[0]
  const open = await github<{ number: number, html_url: string }[]>(`/repos/${pr.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${pr.branch}`)}`, token)
  if (open.length) {
    await github(`/repos/${pr.repo}/pulls/${open[0].number}`, token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: pr.title, body: pr.body }) })
    return { number: open[0].number, url: open[0].html_url }
  }
  const created = await github<{ number: number, html_url: string }>(`/repos/${pr.repo}/pulls`, token, json({ title: pr.title, body: pr.body, head: `${owner}:${pr.branch}`, base, maintainer_can_modify: true }))
  return { number: created.number, url: created.html_url }
}
