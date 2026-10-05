import type { User } from '@/api/session'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { logout as apiLogout, getMe, saveLocale } from '@/api/session'

export const useSessionStore = defineStore('session', () => {
  const user = ref<User | null>(null)
  const isMaintainer = ref(false)
  const loaded = ref(false)
  const locale = ref<string | null>(null)
  let pending: Promise<void> | null = null

  const isSignedIn = computed(() => user.value !== null)

  function load(force = false): Promise<void> {
    if (loaded.value && !force)
      return Promise.resolve()
    pending ??= getMe().then((me) => {
      user.value = me.user
      isMaintainer.value = me.isMaintainer
      locale.value = me.locale ?? null
      loaded.value = true
    }).finally(() => {
      pending = null
    })
    return pending
  }

  /** Keeps the interface language with the account, so mail comes in it. */
  async function syncLocale(current: string) {
    if (!user.value || locale.value === current)
      return
    locale.value = current
    await saveLocale(current).catch(() => (locale.value = null))
  }

  async function logout() {
    await apiLogout()
    user.value = null
    isMaintainer.value = false
  }

  return { user, isMaintainer, loaded, isSignedIn, load, logout, syncLocale }
})
