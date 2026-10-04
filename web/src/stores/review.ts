import type { QueueItem } from '@/api/review'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getQueue } from '@/api/review'

// How many changes wait for a maintainer, shown on the menu. Pages that load
// the queue or act on a change update it, so the badge follows at once.
export const useReviewStore = defineStore('review', () => {
  const pending = ref(0)

  function count(items: QueueItem[]) {
    pending.value = items.filter(c => c.waitingOn === 'maintainer').length
  }

  async function refresh() {
    try {
      count((await getQueue()).changes)
    }
    catch {}
  }

  return { pending, count, refresh }
})
