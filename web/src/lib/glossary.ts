/** The glossary terms a text uses, longest first, so "Access Log" wins over "Log". */
export function termsIn(terms: Record<string, string>, text: string, limit = 40): [string, string][] {
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Object.entries(terms)
    .filter(([en]) => new RegExp(`\\b${escape(en)}(?:s|es)?\\b`, 'i').test(text))
    .sort((a, b) => b[0].length - a[0].length)
    .slice(0, limit)
}
