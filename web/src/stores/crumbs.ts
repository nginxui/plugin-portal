import { defineStore } from 'pinia'
import { onBeforeUnmount, ref, watchEffect } from 'vue'

export interface Crumb {
  title: string
  to?: string
}

// The breadcrumb of the header bar. Pages with a name of their own set it,
// the others get one from their route.
export const useCrumbStore = defineStore('crumbs', () => {
  const items = ref<Crumb[] | null>(null)
  const owner = ref<symbol | null>(null)
  return { items, owner }
})

export function useCrumbs(source: () => Crumb[] | null) {
  const store = useCrumbStore()
  const token = Symbol('crumbs')
  watchEffect(() => {
    store.items = source()
    store.owner = token
  })
  onBeforeUnmount(() => {
    if (store.owner === token) {
      store.items = null
      store.owner = null
    }
  })
}
