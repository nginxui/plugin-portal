import type { StoreDoc } from './store'

// Image paths of a document as they land in a repository.
export function repoFiles(doc: StoreDoc): { doc: StoreDoc, images: { sha: string, path: string }[] } {
  const out: { sha: string, path: string }[] = []
  const place = (path: string | undefined, name: string) => {
    if (!path?.startsWith('media:'))
      return path
    const target = `docs/screenshots/${name}.webp`
    out.push({ sha: path.slice(6), path: target })
    return target
  }
  const screenshots = doc.screenshots?.map(s => ({ ...s, path: place(s.path, s.id)!, ...(s.dark_path ? { dark_path: place(s.dark_path, `${s.id}-dark`) } : {}) }))
  return { doc: { ...doc, ...(screenshots ? { screenshots } : {}) }, images: out }
}

export const storeJson = (doc: StoreDoc) => `${JSON.stringify({ $schema: 'https://plugins.nginxui.com/schema/store.schema.json', ...doc }, null, 2)}\n`
