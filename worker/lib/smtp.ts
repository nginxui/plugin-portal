import { WorkerMailer } from 'worker-mailer'

// SMTP through Cloudflare TCP sockets. Port 25 is closed to Workers, so this
// is mail submission on 465 (TLS from the start) or 587 (STARTTLS).

export interface SmtpConfig {
  host: string
  port: number
  user: string
  password: string
  from: string
}

// worker-mailer goes on without TLS when a server on 587 offers no STARTTLS,
// and would then send the password in the clear. Signing in is refused unless
// the connection is encrypted.
const proto = WorkerMailer.prototype as unknown as { auth: () => Promise<void>, tls: () => Promise<void> }
const auth = proto.auth
const tls = proto.tls
proto.tls = async function (this: { encrypted?: boolean }) {
  await tls.call(this)
  this.encrypted = true
}
proto.auth = async function (this: { secure?: boolean, encrypted?: boolean, allowAuth?: boolean }) {
  if (this.allowAuth && !this.secure && !this.encrypted)
    throw new Error('the server offers no STARTTLS, the password would be sent unencrypted')
  return auth.call(this)
}

/** "Name <address>" or a bare address, as worker-mailer takes it. */
export function sender(from: string): { name?: string, email: string } {
  const open = from.lastIndexOf('<')
  if (open < 0 || !from.trimEnd().endsWith('>'))
    return { email: from.trim() }
  const name = from.slice(0, open).trim().replace(/^"|"$/g, '')
  return { ...(name ? { name } : {}), email: from.slice(open + 1, from.lastIndexOf('>')).trim() }
}

export const smtp = {
  async send(config: SmtpConfig, to: string, subject: string, text: string): Promise<void> {
    await WorkerMailer.send({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      startTls: true,
      ...(config.user ? { credentials: { username: config.user, password: config.password } } : {}),
      authType: ['plain', 'login', 'cram-md5'],
      socketTimeoutMs: 15000,
      responseTimeoutMs: 15000,
    }, { from: sender(config.from), to, subject, text })
  },
}
