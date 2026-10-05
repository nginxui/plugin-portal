import type { Env } from '../env'
import { mailConfig } from './settings'

// Email for the tracker (spec 11.1): sent through an HTTP mail API when one
// is configured on the Settings page or in the Worker variables, else not at
// all. The API takes { from, to, subject, text }, as Resend and similar
// services do.

export async function mailEnabled(env: Env): Promise<boolean> {
  return !!await mailConfig(env)
}

export async function sendMail(env: Env, to: string, subject: string, text: string): Promise<boolean> {
  const config = await mailConfig(env)
  if (!config || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(to))
    return false
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.from, to, subject, text }),
  })
  return response.ok
}
