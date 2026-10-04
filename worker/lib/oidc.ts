import { fromBase64 } from './crypto'
import { now } from './time'

// Verifies the OIDC tokens GitHub Actions mints for a workflow run, so a
// workflow of the catalog repository can report to the portal with no shared
// secret.

const ISSUER = 'https://token.actions.githubusercontent.com'
const JWKS_URL = `${ISSUER}/.well-known/jwks`
const JWKS_SECONDS = 3600

interface Jwk extends JsonWebKey {
  kid: string
}

export interface ActionsClaims {
  iss: string
  aud: string | string[]
  exp: number
  nbf?: number
  iat: number
  repository: string
  repository_owner: string
  workflow_ref: string
  ref: string
  run_id: string
  event_name: string
}

export class OidcError extends Error {}

async function jwks(): Promise<Jwk[]> {
  const cache = caches.default
  const hit = await cache.match(JWKS_URL)
  if (hit)
    return ((await hit.json()) as { keys: Jwk[] }).keys
  const response = await fetch(JWKS_URL)
  if (!response.ok)
    throw new OidcError(`jwks: ${response.status}`)
  const body = await response.text()
  await cache.put(JWKS_URL, new Response(body, { headers: { 'Cache-Control': `max-age=${JWKS_SECONDS}` } }))
  return (JSON.parse(body) as { keys: Jwk[] }).keys
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(fromBase64(part)))
}

/**
 * Checks the signature, issuer, audience and lifetime of a token and that it
 * was minted for `workflow` of `repository` on its default branch.
 */
export async function verifyActionsToken(token: string, expected: { audience: string, repository: string, workflow: string }): Promise<ActionsClaims> {
  const [head, body, signature] = token.split('.')
  if (!head || !body || !signature)
    throw new OidcError('malformed token')
  const header = decodeJson<{ alg: string, kid: string }>(head)
  if (header.alg !== 'RS256')
    throw new OidcError('unexpected algorithm')
  const jwk = (await jwks()).find(k => k.kid === header.kid)
  if (!jwk)
    throw new OidcError('unknown key')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64(signature), new TextEncoder().encode(`${head}.${body}`))
  if (!valid)
    throw new OidcError('bad signature')

  const claims = decodeJson<ActionsClaims>(body)
  const t = now()
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== ISSUER)
    throw new OidcError('wrong issuer')
  if (!audiences.includes(expected.audience))
    throw new OidcError('wrong audience')
  if (claims.exp < t - 30 || (claims.nbf ?? claims.iat) > t + 30)
    throw new OidcError('expired')
  if (claims.repository !== expected.repository)
    throw new OidcError('wrong repository')
  if (claims.workflow_ref !== `${expected.repository}/.github/workflows/${expected.workflow}@refs/heads/main`)
    throw new OidcError('wrong workflow')
  return claims
}
