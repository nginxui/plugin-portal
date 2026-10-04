<script setup lang="ts">
import type { Installable, PluginSummary } from '@/api/plugins'
import { computed, onMounted, ref } from 'vue'
import { getMyPlugins } from '@/api/plugins'
import { $gettext } from '@/lib/gettext'
import { fromNow } from '@/lib/time'

const plugins = ref<PluginSummary[]>([])
const installable = ref<Installable[]>([])
const installUrl = ref('')
const loading = ref(true)
const failed = ref(false)
const ownerFilter = ref('all')

async function load() {
  loading.value = true
  failed.value = false
  try {
    const data = await getMyPlugins()
    plugins.value = data.plugins
    installable.value = data.installable
    installUrl.value = data.installUrl
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

const ownerOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const plugin of plugins.value) {
    const login = plugin.owner?.login
    if (login)
      counts.set(login, (counts.get(login) ?? 0) + 1)
  }
  return [
    { value: 'all', label: `${$gettext('All')} ${plugins.value.length}` },
    ...[...counts].map(([login, count]) => ({ value: login, label: `${login} ${count}` })),
  ]
})

const shown = computed(() => ownerFilter.value === 'all'
  ? plugins.value
  : plugins.value.filter(p => p.owner?.login === ownerFilter.value))
</script>

<template>
  <div class="page">
    <div>
      <h1 class="page-title">
        {{ $gettext('My plugins') }}
      </h1>
      <ATypographyText type="secondary">
        {{ $gettext('Manage the plugins you list in the catalog and follow changes under review.') }}
      </ATypographyText>
    </div>

    <AAlert
      v-if="failed"
      type="error"
      show-icon
      :title="$gettext('Your plugins could not be loaded.')"
    >
      <template #action>
        <AButton size="small" @click="load">
          {{ $gettext('Retry') }}
        </AButton>
      </template>
    </AAlert>

    <ACard :title="$gettext('Plugins')" :loading="loading">
      <div v-if="ownerOptions.length > 2" class="overflow-x-auto pb-2">
        <ASegmented v-model:value="ownerFilter" :options="ownerOptions" :aria-label="$gettext('Filter by owner')" />
      </div>
      <AEmpty v-if="shown.length === 0" :description="$gettext('You have no role on any listed plugin yet.')">
        <ATypographyText type="secondary" class="text-3">
          {{ $gettext('Plugins appear here when you have admin, maintain, write or triage permission on their repository.') }}
        </ATypographyText>
      </AEmpty>
      <PluginRow v-for="plugin in shown" :key="plugin.id" :plugin="plugin" />
    </ACard>

    <ACard :title="$gettext('Repositories you can submit')" :loading="loading">
      <ATypographyParagraph type="secondary">
        {{ $gettext('These repositories have the Nginx UI Plugin Catalog app installed by you. With the app installed, new releases reach the catalog within minutes.') }}
      </ATypographyParagraph>
      <AEmpty v-if="installable.length === 0" :description="$gettext('No repository is waiting to be submitted.')" />
      <AFlex v-for="repo in installable" :key="repo.repoId" align="center" gap="middle" class="py-3">
        <span class="i-tabler-brand-github text-6 op-65" />
        <div class="flex-1 min-w-0">
          <a :href="`https://github.com/${repo.repo}`" target="_blank" rel="noopener" class="font-600">{{ repo.repo }}</a>
          <div class="text-3 op-65">
            {{ $gettext('App installed %{time}', { time: fromNow(repo.installedAt) }) }}
          </div>
        </div>
      </AFlex>
      <a :href="installUrl" target="_blank" rel="noopener" class="inline-block mt-2">
        {{ $gettext('Install the app on another repository') }}
        <span class="i-tabler-external-link" />
      </a>
    </ACard>
  </div>
</template>
