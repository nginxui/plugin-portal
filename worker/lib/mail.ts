import type { Env } from '../env'
import { mailConfig } from './settings'
import { smtp } from './smtp'

// Email for the tracker (spec 11.1): sent through an HTTP mail API or SMTP
// when one is configured on the Settings page or in the Worker variables,
// else not at all. The HTTP API takes { from, to, subject, text }, as Resend
// and similar services do.

export async function mailEnabled(env: Env): Promise<boolean> {
  return !!await mailConfig(env)
}

export interface MailResult {
  ok: boolean
  // What the mail API answered when it refused, for the test mail.
  status?: number
  message?: string
}

/** Sends one mail; html, when given, goes with the text as its other form. */
export async function sendMail(env: Env, to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  const config = await mailConfig(env)
  if (!config || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(to))
    return { ok: false }
  if (config.kind === 'smtp') {
    try {
      await smtp.send(config, to, subject, text, html)
      return { ok: true }
    }
    catch (error) {
      return { ok: false, message: (error instanceof Error ? error.message : String(error)).slice(0, 300) }
    }
  }
  let response: Response
  try {
    response = await fetch(config.url, {
      method: 'POST',
      // Resend and others refuse a request without a User-Agent.
      headers: { 'Authorization': `Bearer ${config.key}`, 'Content-Type': 'application/json', 'User-Agent': 'nginxui-plugin-portal' },
      body: JSON.stringify({ from: config.from, to, subject, text, ...(html ? { html } : {}) }),
    })
  }
  catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (response.ok)
    return { ok: true }
  const body = await response.text().catch(() => '')
  let message = body
  try {
    const parsed = JSON.parse(body) as { message?: unknown, error?: unknown }
    message = String(parsed.message ?? (typeof parsed.error === 'string' ? parsed.error : '') ?? body)
  }
  catch {}
  return { ok: false, status: response.status, message: message.slice(0, 300) }
}
