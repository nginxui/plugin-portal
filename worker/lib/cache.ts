// A small edge cache for values read from GitHub, keyed by a synthetic URL.
// It only saves requests; nothing that grants access is read from it.
export async function cached<T>(key: string, seconds: number, load: () => Promise<T>): Promise<T> {
  const url = `https://portal.cache/${encodeURIComponent(key)}`
  const hit = await caches.default.match(url)
  if (hit)
    return hit.json() as Promise<T>
  const value = await load()
  await store(key, seconds, value)
  return value
}

/** Puts a value in the edge cache, replacing what it held. */
export async function store<T>(key: string, seconds: number, value: T): Promise<void> {
  await caches.default.put(`https://portal.cache/${encodeURIComponent(key)}`, new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${seconds}` },
  }))
}
