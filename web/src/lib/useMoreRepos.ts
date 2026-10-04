import type { Installable } from '@/api/plugins'
import { computed, ref } from 'vue'
import { getMoreRepositories } from '@/api/plugins'

const PAGE = 10

/** Repositories beyond the ones with the app installed, read and shown a page at a time. */
export function useMoreRepos() {
  const all = ref<Installable[] | null>(null)
  const count = ref(0)
  const loading = ref(false)
  const failed = ref(false)

  const shown = computed(() => (all.value ?? []).slice(0, count.value))
  const hasMore = computed(() => all.value === null || count.value < all.value.length)
  const left = computed(() => all.value === null ? null : all.value.length - count.value)

  async function loadMore() {
    if (all.value === null) {
      loading.value = true
      failed.value = false
      try {
        all.value = (await getMoreRepositories()).repos
      }
      catch {
        failed.value = true
        return
      }
      finally {
        loading.value = false
      }
    }
    count.value += PAGE
  }

  return { shown, hasMore, left, loading, failed, loadMore }
}
