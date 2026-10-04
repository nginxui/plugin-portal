<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { submitSelfService } from '@/api/plugins'
import { getCategories } from '@/api/submit'
import { $gettext } from '@/lib/gettext'

// Changing categories is self service: it takes effect at the next update.
const props = defineProps<{ pluginId: string, current: string[] }>()
const open = defineModel<boolean>('open', { required: true })
const router = useRouter()

const known = ref<string[]>([])
const chosen = ref<string[]>([])
const saving = ref(false)
const error = ref('')

watch(open, async (value) => {
  if (!value)
    return
  chosen.value = [...props.current]
  error.value = ''
  if (!known.value.length)
    known.value = (await getCategories().catch(() => ({ categories: [] }))).categories
})

const unchanged = computed(() => chosen.value.length === 0 || [...chosen.value].sort().join() === [...props.current].sort().join())

async function save() {
  saving.value = true
  error.value = ''
  try {
    const { change } = await submitSelfService(props.pluginId, { categories: chosen.value })
    open.value = false
    router.push(`/changes/${change}`)
  }
  catch (e) {
    error.value = e instanceof ApiError && e.code === 'busy'
      ? $gettext('Another change of this plugin is in progress.')
      : $gettext('The change could not be sent. Please try again.')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <AModal v-model:open="open" :title="$gettext('Change categories')" :confirm-loading="saving" :ok-text="$gettext('Save')" :ok-button-props="{ disabled: unchanged }" @ok="save">
    <p class="op-75">
      {{ $gettext('The catalog files the plugin under these categories from its next update.') }}
    </p>
    <CategoryPicker v-model="chosen" :options="known" />
    <AAlert v-if="error" type="error" show-icon class="mt-3" :title="error" />
  </AModal>
</template>
