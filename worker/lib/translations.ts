import type { Env } from '../env'
import type { PluginContext } from './pluginContext'
import type { StoreDoc } from './store'
import { botEnabled, openBotPullRequest } from './bot'
import { event, newChangeId } from './changes'
import { dispatchApply } from './deployApp'
import { readStore } from './store'
import { repoFiles, storeJson } from './storeFiles'
import { now } from './time'

// Community translations (spec 9): accepted suggestions go out through the
// plugin's store source with no further step. A repository gets one rolling
// pull request per plugin on portal/translations, a commit per accepted
// batch with the translators as co-authors; the catalog source commits.

export interface SuggestionRow {
  id: number
  plugin_id: string
  field: string
  locale: string
  text: string
  author_id: number
  state: 'pending' | 'accepted' | 'declined' | 'merged'
  reason: string | null
  decided_by: number | null
  decided_at: number | null
  change_id: string | null
  created_at: number
}

const FIELD = /^(?:name|description|caption:[a-z0-9][a-z0-9-]{0,31})$/

export function validField(field: string): boolean {
  return FIELD.test(field)
}

/** The text of a field in a document. */
export function textOf(doc: StoreDoc, field: string, locale: string): string {
  if (field === 'name' || field === 'description')
    return doc[field]?.[locale] ?? ''
  return doc.screenshots?.find(s => s.id === field.slice(8))?.caption?.[locale] ?? ''
}

/** A document with suggestions applied, the last one per text winning. */
export function applySuggestions(doc: StoreDoc, suggestions: Pick<SuggestionRow, 'field' | 'locale' | 'text'>[]): StoreDoc {
  const out = structuredClone(doc)
  for (const s of suggestions) {
    if (s.field === 'name' || s.field === 'description') {
      out[s.field] = { ...(out[s.field] ?? {}), [s.locale]: s.text }
    }
    else {
      const id = s.field.slice(8)
      out.screenshots = out.screenshots?.map(shot => shot.id === id ? { ...shot, caption: { ...(shot.caption ?? {}), [s.locale]: s.text } } : shot)
    }
  }
  return out
}

interface Translator {
  login: string
  id: number
}

/**
 * Sends the accepted suggestions of a plugin that are not out yet. Returns the
 * change that carries them, or null when there is nothing to send or the
 * store source cannot take them.
 */
export async function flushAccepted(env: Env, ctx: PluginContext, actor: Translator): Promise<{ change: string, delivery: string } | null> {
  const { results } = await env.DB.prepare(
    `SELECT s.*, u.login AS login FROM suggestions s LEFT JOIN users u ON u.id = s.author_id
     WHERE s.plugin_id = ? AND s.state = 'accepted' AND s.change_id IS NULL ORDER BY s.decided_at, s.id`,
  ).bind(ctx.id).all<SuggestionRow & { login: string | null }>()
  if (!results.length)
    return null
  const state = await readStore(env, ctx.token, { id: ctx.id, repo: ctx.repo, tag: ctx.tag, entry: ctx.entry })
  if (state.source === 'release')
    return null
  const doc = applySuggestions(state.doc, results)
  const translators = new Map<string, Translator>()
  for (const s of results) {
    if (s.login)
      translators.set(s.login, { login: s.login, id: s.author_id })
  }
  const t = now()
  const open = await env.DB.prepare(`SELECT id, pr_number FROM changes WHERE plugin_id = ? AND kind = 'translations' AND state = 'open' ORDER BY created_at DESC LIMIT 1`)
    .bind(ctx.id)
    .first<{ id: string, pr_number: number | null }>()
  const change = open?.id ?? newChangeId()
  const payload: Record<string, unknown> = { kind: state.source === 'catalog' ? 'store_update' : 'store_repo', plugin_id: ctx.id, doc, readme: null, set_source: null, submitter: { login: actor.login, id: actor.id }, eligibility: `community translations accepted by @${actor.login}`, repo: ctx.repo }
  let delivery = 'catalog'
  let prNumber: number | null = open?.pr_number ?? null
  if (state.source !== 'catalog') {
    const { doc: repoDoc } = repoFiles(doc)
    payload.repo_doc = repoDoc
    if (botEnabled(env)) {
      const changeUrl = `${env.PORTAL_ORIGIN}/changes/${change}`
      const pr = await openBotPullRequest(env, {
        repo: ctx.repo!,
        branch: 'portal/translations',
        title: 'Community translations of the store texts',
        body: [
          `Translations of the store texts of \`${ctx.id}\` that the community suggested and @${actor.login} accepted in the Nginx UI developer portal. New batches are added to this pull request until it is merged.`,
          '',
          `Translators: ${[...translators.keys()].map(l => `@${l}`).join(', ')}`,
          '',
          `Follow it in the portal: ${changeUrl}`,
        ].join('\n'),
        message: ['Add community translations of the store texts', '', `Accepted by @${actor.login} in the developer portal.`, '', ...[...translators.values()].map(tr => `Co-authored-by: ${tr.login} <${tr.id}+${tr.login}@users.noreply.github.com>`)].join('\n'),
        files: [{ path: 'plugin.store.json', content: storeJson(repoDoc) }],
      })
      prNumber = pr.number
      payload.pr_url = pr.url
      delivery = 'bot'
    }
    else {
      delivery = 'patch'
    }
  }
  payload.delivery = delivery
  const statements = [
    open
      ? env.DB.prepare(`UPDATE changes SET payload_json = ?, pr_number = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(payload), prNumber, t, change)
      : env.DB.prepare(
          `INSERT INTO changes (id, plugin_id, author_id, kind, class, state, stage, waiting_on, pr_number, payload_json, dispatched_at, created_at, updated_at)
           VALUES (?, ?, ?, 'translations', 'self_service', 'open', ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(change, ctx.id, actor.id, state.source === 'catalog' ? 'checks' : 'review', state.source === 'catalog' ? 'system' : 'author', prNumber, JSON.stringify(payload), t, t, t),
    event(env, change, open ? 'batch' : 'submitted', actor.id, { suggestions: results.length, translators: [...translators.keys()] }),
    env.DB.prepare(`UPDATE suggestions SET change_id = ? WHERE id IN (${results.map(() => '?').join(',')})`).bind(change, ...results.map(s => s.id)),
  ]
  if (prNumber) {
    statements.push(env.DB.prepare(
      `INSERT INTO plugins (plugin_id, repo_full_name, state, translations_pr, created_at, updated_at) VALUES (?, ?, 'listed', ?, ?, ?)
       ON CONFLICT (plugin_id) DO UPDATE SET translations_pr = excluded.translations_pr, updated_at = excluded.updated_at`,
    ).bind(ctx.id, ctx.repo, prNumber, t, t))
  }
  await env.DB.batch(statements)
  if (state.source === 'catalog')
    await dispatchApply(env, change, payload).catch(error => console.error('dispatch failed', error))
  return { change, delivery }
}
