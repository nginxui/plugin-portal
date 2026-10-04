// A small edge cache for values read from GitHub, keyed by a synthetic URL.
// It only saves requests; nothing that grants access is read from it.
export async function cached<T>(key: string, seconds: number, load: () => Promise<T>): Promise<T> {
  const url = `https://portal.cache/${encodeURIComponent(key)}`
  const cache = caches.default
  const hit = await cache.match(url)
  if (hit)
    return hit.json() as Promise<T>
  const value = await load()
  await cache.put(url, new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${seconds}` },
  }))
  return value
}
