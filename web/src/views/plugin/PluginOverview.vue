<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { submitSelfService } from '@/api/plugins'
import { getCategories } from '@/api/submit'
import { categoryLabel } from '@/lib/categories'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { usePluginStore } from '@/stores/plugin'

const store = usePluginStore()
const router = useRouter()
const plugin = computed(() => store.detail!.plugin)
const canEdit = computed(() => (plugin.value.role === 'admin' || plugin.value.role === 'publisher') && !store.detail!.pending && store.detail!.listed)

const editing = ref(false)
const known = ref<string[]>([])
const chosen = ref<string[]>([])
const saving = ref(false)
const error = ref('')

async function editCategories() {
  chosen.value = [...plugin.value.categories]
  error.value = ''
  editing.value = true
  if (!known.value.length)
    known.value = (await getCategories().catch(() => ({ categories: [] }))).categories
}

const unchanged = computed(() => chosen.value.length === 0 || [...chosen.value].sort().join() === [...plugin.value.categories].sort().join())

async function saveCategories() {
  saving.value = true
  error.value = ''
  try {
    const { change } = await submitSelfService(plugin.value.id, { categories: chosen.value })
    editing.value = false
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
  <AFlex vertical gap="middle">
    <PendingChange />
    <ACard :title="$gettext('Listing')">
      <ADescriptions :column="{ xs: 1, md: 2 }">
        <ADescriptionsItem v-if="localized(plugin.description)" :label="$gettext('Description')" :span="2">
          {{ localized(plugin.description) }}
        </ADescriptionsItem>
        <ADescriptionsItem :label="$gettext('Repository')">
          <a v-if="plugin.repo" :href="`https://github.com/${plugin.repo}`" target="_blank" rel="noopener">{{ plugin.repo }}</a>
        </ADescriptionsItem>
        <ADescriptionsItem :label="$gettext('Owner')">
          <RouterLink v-if="plugin.owner" :to="`/owners/${plugin.owner.login}`">
            {{ plugin.owner.login }}
          </RouterLink>
        </ADescriptionsItem>
        <ADescriptionsItem :label="$gettext('Categories')">
          <ATag v-for="category in plugin.categories" :key="category">
            {{ categoryLabel(category) }}
          </ATag>
          <a v-if="canEdit" class="text-3" role="button" tabindex="0" @click.prevent="editCategories" @keydown.enter.prevent="editCategories">{{ $gettext('Edit') }}</a>
        </ADescriptionsItem>
        <ADescriptionsItem v-if="plugin.version" :label="$gettext('Latest version')">
          v{{ plugin.version }}
        </ADescriptionsItem>
      </ADescriptions>
    </ACard>
    <AModal v-model:open="editing" :title="$gettext('Change categories')" :confirm-loading="saving" :ok-text="$gettext('Save')" :ok-button-props="{ disabled: unchanged }" @ok="saveCategories">
      <p class="op-75">
        {{ $gettext('The catalog files the plugin under these categories from its next update.') }}
      </p>
      <CategoryPicker v-model="chosen" :options="known" />
      <AAlert v-if="error" type="error" show-icon class="mt-3" :title="error" />
    </AModal>
  </AFlex>
</template>
