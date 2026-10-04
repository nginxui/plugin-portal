// Reads the "| Field | Listed as |" table of the listing preview that the
// catalog checks write, so it can be shown without rendering Markdown.
export interface PreviewRow {
  field: string
  lines: string[]
}

export function previewRows(markdown: string | null | undefined): PreviewRow[] {
  const rows: PreviewRow[] = []
  for (const raw of String(markdown ?? '').split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|') || !line.endsWith('|'))
      continue
    const [field = '', ...rest] = line.slice(1, -1).split('|').map(part => part.trim())
    if (!field || field === 'Field' || /^-+$/.test(field))
      continue
    rows.push({ field, lines: rest.join('|').split(/<br\s*\/?>/i).map(part => part.replace(/`/g, '').trim()).filter(Boolean) })
  }
  return rows
}
