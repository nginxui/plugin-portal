// The README badges the catalog renders (nginxui/plugins, scripts/badges.mjs),
// drawn here too so the preview needs no deploy. Keep the two in step.

export const BADGE_KINDS = ['status', 'version', 'translations', 'requires'] as const
export type BadgeKind = typeof BADGE_KINDS[number]
export const BADGE_LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'de_DE', 'fr_FR', 'es', 'it_IT', 'pt_PT', 'ru_RU', 'uk_UA', 'tr_TR', 'vi_VN', 'ar']
const HOST_LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'de_DE', 'fr_FR', 'es', 'pt_PT', 'ru_RU', 'uk_UA', 'tr_TR', 'vi_VN', 'ar']

export const BADGE_STRINGS: Record<string, Record<string, string>> = {
  en: { plugin: 'Nginx UI plugin', listed: 'listed', version: 'version', yanked: 'yanked', translations: 'translations', requires: 'requires', any: 'any Nginx UI' },
  zh_CN: { plugin: 'Nginx UI 插件', listed: '已上架', version: '版本', yanked: '已撤回', translations: '翻译', requires: '需要', any: '任意 Nginx UI' },
  zh_TW: { plugin: 'Nginx UI 外掛', listed: '已上架', version: '版本', yanked: '已撤回', translations: '翻譯', requires: '需要', any: '任意 Nginx UI' },
  ja_JP: { plugin: 'Nginx UI プラグイン', listed: '掲載中', version: 'バージョン', yanked: '取り下げ', translations: '翻訳', requires: '必要', any: 'すべての Nginx UI' },
  ko_KR: { plugin: 'Nginx UI 플러그인', listed: '등록됨', version: '버전', yanked: '철회됨', translations: '번역', requires: '필요', any: '모든 Nginx UI' },
  de_DE: { plugin: 'Nginx UI Plugin', listed: 'gelistet', version: 'Version', yanked: 'zurückgezogen', translations: 'Übersetzungen', requires: 'benötigt', any: 'jedes Nginx UI' },
  fr_FR: { plugin: 'Plugin Nginx UI', listed: 'référencé', version: 'version', yanked: 'retirée', translations: 'traductions', requires: 'requiert', any: 'tout Nginx UI' },
  es: { plugin: 'Plugin de Nginx UI', listed: 'publicado', version: 'versión', yanked: 'retirada', translations: 'traducciones', requires: 'requiere', any: 'cualquier Nginx UI' },
  it_IT: { plugin: 'Plugin Nginx UI', listed: 'pubblicato', version: 'versione', yanked: 'ritirata', translations: 'traduzioni', requires: 'richiede', any: 'qualsiasi Nginx UI' },
  pt_PT: { plugin: 'Plugin do Nginx UI', listed: 'publicado', version: 'versão', yanked: 'retirada', translations: 'traduções', requires: 'requer', any: 'qualquer Nginx UI' },
  ru_RU: { plugin: 'Плагин Nginx UI', listed: 'в каталоге', version: 'версия', yanked: 'отозвана', translations: 'переводы', requires: 'требуется', any: 'любой Nginx UI' },
  uk_UA: { plugin: 'Плагін Nginx UI', listed: 'у каталозі', version: 'версія', yanked: 'відкликана', translations: 'переклади', requires: 'потрібен', any: 'будь-який Nginx UI' },
  tr_TR: { plugin: 'Nginx UI eklentisi', listed: 'listelendi', version: 'sürüm', yanked: 'geri çekildi', translations: 'çeviriler', requires: 'gerekir', any: 'her Nginx UI' },
  vi_VN: { plugin: 'Plugin Nginx UI', listed: 'đã niêm yết', version: 'phiên bản', yanked: 'đã rút', translations: 'bản dịch', requires: 'yêu cầu', any: 'mọi Nginx UI' },
  ar: { plugin: 'إضافة Nginx UI', listed: 'مدرجة', version: 'الإصدار', yanked: 'مسحوب', translations: 'الترجمات', requires: 'يتطلب', any: 'أي Nginx UI' },
}

const COLORS: Record<string, string> = { status: '#389e0d', version: '#1677ff', yanked: '#cf1322', translations: '#722ed1', requires: '#595959' }

function escapeXml(text: string): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The width of a text in pixels at the badge font size, close enough for a badge. */
export function textWidth(text: string, size = 11): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x2E80)
      width += size
    else if ('iljtfr.,:;|!\' '.includes(char))
      width += size * 0.33
    else if (/[A-Zmw]/.test(char))
      width += size * 0.72
    else
      width += size * 0.56
  }
  return Math.ceil(width)
}

/** One badge as SVG: a label and a value on a coloured background. */
export function badgeSvg(label: string, value: string, color: string, style = ''): string {
  const large = style === 'large'
  const size = large ? 13 : 11
  const height = large ? 28 : 20
  const pad = large ? 10 : 6
  const radius = style === 'square' ? 0 : large ? 4 : 3
  const left = textWidth(label, size) + pad * 2
  const right = textWidth(value, size) + pad * 2
  const width = left + right
  const baseline = large ? 18 : 14
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${escapeXml(`${label}: ${value}`)}"><title>${escapeXml(`${label}: ${value}`)}</title><clipPath id="r"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${left}" height="${height}" fill="#555"/><rect x="${left}" width="${right}" height="${height}" fill="${color}"/></g><g fill="#fff" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Verdana,sans-serif" font-size="${size}"><text x="${left / 2}" y="${baseline}">${escapeXml(label)}</text><text x="${left + right / 2}" y="${baseline}">${escapeXml(value)}</text></g></svg>\n`
}

export interface BadgePlugin {
  name: Record<string, string>
  description: Record<string, string> | null
  releases: { version: string, yanked: boolean, minNginxUiVersion: string | null }[]
}

export function badgeContent(plugin: BadgePlugin, kind: BadgeKind, locale: string): { label: string, value: string, color: string } {
  const t = BADGE_STRINGS[locale] ?? BADGE_STRINGS.en
  if (kind === 'status')
    return { label: t.plugin, value: t.listed, color: COLORS.status }
  if (kind === 'version') {
    const release = plugin.releases[0]
    if (!release)
      return { label: t.version, value: '—', color: COLORS.requires }
    if (release.yanked)
      return { label: t.version, value: `v${release.version} ${t.yanked}`, color: COLORS.yanked }
    return { label: t.version, value: `v${release.version}`, color: COLORS.version }
  }
  if (kind === 'translations') {
    const has = new Set([...Object.keys(plugin.name ?? {}), ...Object.keys(plugin.description ?? {})])
    return { label: t.translations, value: `${HOST_LOCALES.filter(l => has.has(l)).length} / ${HOST_LOCALES.length}`, color: COLORS.translations }
  }
  const shown = plugin.releases.find(r => !r.yanked) ?? plugin.releases[0]
  return { label: t.requires, value: shown?.minNginxUiVersion ? `Nginx UI ${shown.minNginxUiVersion}+` : t.any, color: COLORS.requires }
}

export function badgeDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
