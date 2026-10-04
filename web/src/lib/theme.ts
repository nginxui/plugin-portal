import { usePreferredDark } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

export type ThemeChoice = 'auto' | 'light' | 'dark'

const STORAGE_KEY = 'portal-theme'

function initialChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark')
      return saved
  }
  catch {}
  return 'auto'
}

const choice = ref<ThemeChoice>(initialChoice())
const prefersDark = usePreferredDark()

export const isDark = computed(() => choice.value === 'dark' || (choice.value === 'auto' && prefersDark.value))

watch(isDark, (dark) => {
  document.documentElement.classList.toggle('dark', dark)
}, { immediate: true })

export function toggleTheme() {
  choice.value = isDark.value ? 'light' : 'dark'
  try {
    localStorage.setItem(STORAGE_KEY, choice.value)
  }
  catch {}
}
