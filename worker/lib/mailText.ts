// The mail the portal sends, in the languages of its interface, as plain
// text and as HTML built from the same parts. A user who never picked a
// language gets English.

export const MAIL_LOCALES = ['en', 'zh_CN']

interface Parts {
  subject: string
  // The heading of the mail and the paragraph under it.
  title: string
  body: string
}

type Kind = 'checks' | 'changes_requested' | 'rejected' | 'reminder' | 'live' | 'test'

// p is the plugin's name; c names the change, as "Delisting #9" in a heading
// and "delisting #9" inside a sentence. In Chinese gap separates a number
// from the text after it.
interface Change { title: string, inline: string, gap: string }

const PARTS: Record<string, Record<Kind, (p: string, c: Change) => Parts>> = {
  en: {
    checks: (p, c) => ({ subject: `The checks found problems in your ${c.inline} to ${p}`, title: `${c.title} did not pass the checks`, body: `The checks of your ${c.inline} to ${p} found problems. Fix them, then run the checks again from the change page.` }),
    changes_requested: (p, c) => ({ subject: `A maintainer asked for changes to your ${c.inline} to ${p}`, title: 'A maintainer asked for changes', body: `A maintainer asked for changes to your ${c.inline} to ${p}. Once they are made, run the checks again from the change page.` }),
    rejected: (p, c) => ({ subject: `Your ${c.inline} to ${p} was rejected`, title: `${c.title} was rejected`, body: `Your ${c.inline} to ${p} was rejected and goes no further. If it is still needed, send a new one.` }),
    reminder: (p, c) => ({ subject: `Your ${c.inline} to ${p} waits for you`, title: `${c.title} waits for you`, body: `Your ${c.inline} to ${p} has waited for you for a while.` }),
    live: (p, c) => ({ subject: `Your ${c.inline} to ${p} is live`, title: `${c.title} is live`, body: `Your ${c.inline} to ${p} is live in the catalog. Nginx UI shows it at its next marketplace refresh.` }),
    test: () => ({ subject: 'Test mail from the Nginx UI Developer Center', title: 'The mail service works', body: 'This is a test. Authors who turn on email get progress mail from this sender.' }),
  },
  zh_CN: {
    checks: (p, c) => ({ subject: `“${p}”的${c.inline}${c.gap}未通过检查`, title: `${c.title}${c.gap}未通过检查`, body: `你对“${p}”提交的${c.inline}${c.gap}在检查中发现问题。请修复后在更改页面重新运行检查。` }),
    changes_requested: (p, c) => ({ subject: `维护者要求修改“${p}”的${c.inline}`, title: '维护者要求修改', body: `维护者要求修改你对“${p}”提交的${c.inline}。修改完成后，请在更改页面重新运行检查。` }),
    rejected: (p, c) => ({ subject: `“${p}”的${c.inline}${c.gap}已被拒绝`, title: `${c.title}${c.gap}已被拒绝`, body: `你对“${p}”提交的${c.inline}${c.gap}已被拒绝，不会继续处理。如仍有需要，请发起新的提交。` }),
    reminder: (p, c) => ({ subject: `“${p}”的${c.inline}${c.gap}正在等待你处理`, title: `${c.title}${c.gap}正在等待你处理`, body: `你对“${p}”提交的${c.inline}${c.gap}已等待你处理一段时间。` }),
    live: (p, c) => ({ subject: `“${p}”的${c.inline}${c.gap}已上线`, title: `${c.title}${c.gap}已上线`, body: `你对“${p}”提交的${c.inline}${c.gap}已在插件目录中生效，Nginx UI 下次刷新插件市场后即可看到。` }),
    test: () => ({ subject: '来自 Nginx UI 开发者中心的测试邮件', title: '邮件服务工作正常', body: '这是一封测试邮件。开启邮件通知的作者会收到来自此发件人的进度邮件。' }),
  },
}

// The kinds of change as the change page names them.
const KINDS: Record<string, Record<string, string>> = {
  en: { new_listing: 'New listing', names: 'Name change', key: 'Primary key rotation', repository: 'Repository move', delisting: 'Delisting', yank: 'Yanked version', unyank: 'Restored version', revoke_signer: 'Signer revocation', categories: 'Category change', batch: 'Batch change', store: 'Store change', store_source: 'Store source move', translations: 'Community translations', trust: 'Trust change', block: 'Block list entry', partner: 'Partner change', commercial: 'Commercial details', other: 'Change' },
  zh_CN: { new_listing: '新上架', names: '名称变更', key: '主公钥轮换', repository: '仓库迁移', delisting: '下架', yank: '撤回版本', unyank: '恢复版本', revoke_signer: '撤销签名者', categories: '调整分类', batch: '批量更改', store: '商店资料更改', store_source: '迁移商店来源', translations: '社区翻译', trust: '信任级别变更', block: '屏蔽列表条目', partner: '合作伙伴变更', commercial: '商业信息', other: '更改' },
}

function changeName(lang: string, change: MailInput['change']): Change {
  const label = KINDS[lang][change?.kind ?? 'other'] ?? KINDS[lang].other
  const number = change?.number ? ` #${change.number}` : ''
  return lang === 'zh_CN'
    ? { title: `${label}${number}`, inline: `${label}${number}`, gap: number ? ' ' : '' }
    : { title: `${label}${number}`, inline: `${label.charAt(0).toLowerCase()}${label.slice(1)}${number}`, gap: '' }
}

const CHROME: Record<string, { brand: string, open: string, home: string, comment: string, reason: string, footer: string, colon: string }> = {
  en: {
    brand: 'Nginx UI Developer Center',
    open: 'View the change',
    home: 'Open the Developer Center',
    comment: 'The maintainer wrote',
    reason: 'The reason given',
    colon: ': ',
    footer: 'You get this mail because you turned on email notifications in the Nginx UI Developer Center. Turn them off in the notification settings there.',
  },
  zh_CN: {
    brand: 'Nginx UI 开发者中心',
    open: '查看更改',
    home: '打开开发者中心',
    comment: '维护者留言',
    reason: '拒绝原因',
    colon: '：',
    footer: '你收到这封邮件，是因为你在 Nginx UI 开发者中心开启了邮件通知。可在开发者中心的通知设置中关闭。',
  },
}

// The colors of a step, the same as on the change page.
const TONES: Record<Kind, string> = {
  checks: '#faad14',
  changes_requested: '#faad14',
  reminder: '#faad14',
  rejected: '#ff4d4f',
  live: '#52c41a',
  test: '#1677ff',
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
}

export interface MailInput {
  kind: string
  locale: string | null
  plugin?: string
  // Where the button leads: the change, or the portal for a test.
  url: string
  // The portal, which serves the logo of the mail.
  origin: string
  // What a maintainer wrote, for a request or a rejection.
  comment?: string
  // The change the mail is about, named by kind and number.
  change?: { kind: string, number: number | null }
}

export interface Mail {
  subject: string
  text: string
  html: string
  // The sender's name, in the language of the mail.
  fromName: string
}

/** A mail of the given kind in the user's language, falling back to English. */
export function buildMail(input: MailInput): Mail {
  const lang = input.locale && PARTS[input.locale] ? input.locale : 'en'
  const kind = (input.kind in TONES ? input.kind : 'reminder') as Kind
  const parts = PARTS[lang][kind](input.plugin ?? '', changeName(lang, input.change))
  const chrome = CHROME[lang]
  const commentLabel = kind === 'rejected' ? chrome.reason : chrome.comment
  const action = kind === 'test' ? chrome.home : chrome.open
  const comment = input.comment?.trim().slice(0, 2000) ?? ''

  const text = [
    parts.title,
    '',
    parts.body,
    ...(comment ? ['', `${commentLabel}${chrome.colon.trim()}`, comment] : []),
    '',
    `${action}${chrome.colon}${input.url}`,
    '',
    '--',
    chrome.footer,
  ].join('\n')

  const font = lang === 'zh_CN'
    ? '-apple-system, BlinkMacSystemFont, \'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', \'Segoe UI\', sans-serif'
    : '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, \'Helvetica Neue\', Arial, sans-serif'
  const quote = comment
    ? `<tr><td style="padding:0 32px 8px"><div class="muted" style="font-size:12px;color:#8c8c8c;margin-bottom:6px">${escape(commentLabel)}</div><div class="quote" style="padding:10px 14px;border-left:3px solid #d9d9d9;background:#fafafa;border-radius:4px;font-size:14px;line-height:1.6;color:#262626;white-space:pre-wrap;word-break:break-word">${escape(comment)}</div></td></tr>`
    : ''
  const html = `<!doctype html>
<html lang="${lang === 'zh_CN' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(parts.subject)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .page { background: #141414 !important; }
  .card { background: #1f1f1f !important; border-color: #303030 !important; }
  .title, .brand { color: #f0f0f0 !important; }
  .text { color: #bfbfbf !important; }
  .quote { background: #262626 !important; border-left-color: #595959 !important; color: #e8e8e8 !important; }
  .muted { color: #8c8c8c !important; }
}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#f5f5f5;font-family:${font};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden">${escape(parts.body)}</div>
<table class="page" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;vertical-align:middle"><img src="${escape(input.origin)}/mail-logo.png" width="32" height="32" alt="" style="display:block;border:0;outline:none;width:32px;height:32px"></td>
<td class="brand" style="vertical-align:middle;font-size:15px;font-weight:600;color:#262626">${escape(chrome.brand)}</td>
</tr></table></td></tr>
<tr><td class="card" style="background:#ffffff;border:1px solid #f0f0f0;border-radius:12px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="height:4px;background:${TONES[kind]};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="title" style="padding:28px 32px 8px;font-size:20px;line-height:1.4;font-weight:600;color:#1f1f1f">${escape(parts.title)}</td></tr>
<tr><td class="text" style="padding:0 32px 20px;font-size:14px;line-height:1.7;color:#595959">${escape(parts.body)}</td></tr>
${quote}
<tr><td style="padding:12px 32px 32px"><a href="${escape(input.url)}" style="display:inline-block;padding:10px 20px;background:#1677ff;border-radius:6px;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none">${escape(action)}</a></td></tr>
</table>
</td></tr>
<tr><td class="muted" style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:#8c8c8c">${escape(chrome.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`
  return { subject: parts.subject, text, html, fromName: chrome.brand }
}

/** A plugin name in the user's language, then English, then any, then the id. */
export function nameIn(name: Record<string, string> | null | undefined, locale: string | null, fallback: string): string {
  return (locale && name?.[locale]) || name?.en || Object.values(name ?? {})[0] || fallback
}
