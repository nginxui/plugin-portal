import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { watch } from 'vue'
import { getChangeState } from '@/api/changes'

// States after which a change does not move any more.
const SETTLED = new Set(['live', 'rejected', 'withdrawn', 'failed', 'draft'])

export function isSettled(state: string | undefined): boolean {
  return !state || SETTLED.has(state)
}

/**
 * Keeps an open page of a change current: while the change is on its way and
 * the page is visible, asks every few seconds whether it moved and calls
 * reload when it did. A full reload also runs now and then, for a merge made
 * on GitHub that only the full load notices.
 */
export function useChangeWatch(change: () => { id: string, state: string, updatedAt: number } | null | undefined, reload: () => Promise<unknown>, seconds = 8) {
  const visible = useDocumentVisibility()
  let ticks = 0
  let busy = false

  async function check() {
    const current = change()
    if (busy || !current || isSettled(current.state) || visible.value !== 'visible')
      return
    busy = true
    try {
      ticks += 1
      const now = await getChangeState(current.id)
      if (now.updatedAt !== current.updatedAt || now.state !== current.state || ticks % 8 === 0)
        await reload()
    }
    catch {}
    finally {
      busy = false
    }
  }

  useIntervalFn(check, seconds * 1000)
  watch(visible, (value) => {
    if (value === 'visible')
      check()
  })
}
