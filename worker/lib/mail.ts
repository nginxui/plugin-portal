import type { Env } from '../env'

// Email for the tracker (spec 11.1): sent through an HTTP mail API when one
// is configured, else not at all. The API takes { from, to, subject, text },
// as Resend and similar services do.

export function mailEnabled(env: Env): boolean {
  return !!env.EMAIL_API_URL && !!env.EMAIL_API_KEY && !!env.EMAIL_FROM
}

export async function sendMail(env: Env, to: string, subject: string, text: string): Promise<boolean> {
  if (!mailEnabled(env) || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(to))
    return false
  const response = await fetch(env.EMAIL_API_URL!, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
  })
  return response.ok
}
