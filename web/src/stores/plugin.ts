import type { PluginDetail } from '@/api/plugins'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getPlugin } from '@/api/plugins'

// The plugin open in the plugin pages, shared by the header and its tabs.
export const usePluginStore = defineStore('plugin', () => {
  const detail = ref<PluginDetail | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)

  async function open(id: string) {
    if (detail.value?.plugin.id === id)
      return
    loading.value = true
    error.value = null
    detail.value = null
    try {
      detail.value = await getPlugin(id)
    }
    catch (e) {
      error.value = (e as { code?: string }).code ?? 'unknown'
    }
    finally {
      loading.value = false
    }
  }

  return { detail, error, loading, open }
})
