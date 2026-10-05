import type { Env } from '../env'
import { base64url } from './crypto'
import { github } from './github'

// The NGINX UI Catalog Deploy App, installed on the catalog repository with
// Actions write. The portal only starts workflows with it; what they may
// commit is decided in the catalog repository.

function derLength(length: number): number[] {
  if (length < 0x80)
    return [length]
  const bytes: number[] = []
  for (let rest = length; rest > 0; rest >>= 8)
    bytes.unshift(rest & 0xFF)
  return [0x80 | bytes.length, ...bytes]
}

function der(tag: number, content: number[]): number[] {
  return [tag, ...derLength(content.length), ...content]
}

/** The PKCS#8 DER of a PEM private key, wrapping the PKCS#1 form GitHub hands out. */
export function pkcs8FromPem(pem: string): Uint8Array {
  const text = pem.replace(/\\n/g, '\n')
  const pkcs1 = text.includes('BEGIN RSA PRIVATE KEY')
  const encoded = text.replace(/-----(?:BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '')
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  if (!pkcs1)
    return bytes
  const rsaEncryption = [0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01, 0x05, 0x00]
  return Uint8Array.from(der(0x30, [0x02, 0x01, 0x00, ...der(0x30, rsaEncryption), ...der(0x04, [...bytes])]))
}

export async function appJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pkcs8FromPem(privateKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)))
  // Issued a minute back for clock drift, as GitHub recommends.
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)))
  return `${unsigned}.${base64url(signature)}`
}

async function actionsToken(env: Env): Promise<string> {
  const jwt = await appJwt(env.DEPLOY_APP_ID, env.DEPLOY_APP_PRIVATE_KEY)
  const installation = await github<{ id: number }>(`/repos/${env.CATALOG_REPO}/installation`, jwt)
  const [, name] = env.CATALOG_REPO.split('/')
  const access = await github<{ token: string }>(`/app/installations/${installation.id}/access_tokens`, jwt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositories: [name], permissions: { actions: 'write' } }),
  })
  return access.token
}

/** A read only token of the Deploy App, for public data such as release downloads. */
export async function readToken(env: Env): Promise<string> {
  const jwt = await appJwt(env.DEPLOY_APP_ID, env.DEPLOY_APP_PRIVATE_KEY)
  const installation = await github<{ id: number }>(`/repos/${env.CATALOG_REPO}/installation`, jwt)
  const access = await github<{ token: string }>(`/app/installations/${installation.id}/access_tokens`, jwt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions: { metadata: 'read' } }),
  })
  return access.token
}

/** Starts apply.yml in the catalog repository for a change. */
export async function dispatchApply(env: Env, change: string, payload: unknown): Promise<void> {
  const token = await actionsToken(env)
  await github(`/repos/${env.CATALOG_REPO}/actions/workflows/apply.yml/dispatches`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { change, payload: JSON.stringify(payload) } }),
  })
}

/** Starts the catalog deploy, so a merged store change is listed within minutes. */
export async function dispatchDeploy(env: Env): Promise<void> {
  const token = await actionsToken(env)
  await github(`/repos/${env.CATALOG_REPO}/actions/workflows/${env.DEPLOY_WORKFLOW ?? 'deploy.yml'}/dispatches`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  })
}
