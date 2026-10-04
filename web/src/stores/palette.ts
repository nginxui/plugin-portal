import { defineStore } from 'pinia'
import { ref } from 'vue'

// The command palette, opened with Cmd+K or Ctrl+K from any page.
export const usePaletteStore = defineStore('palette', () => {
  const isOpen = ref(false)
  const modifier = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'

  function show() {
    isOpen.value = true
  }

  function hide() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  return { isOpen, modifier, show, hide, toggle }
})
