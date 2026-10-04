<script setup lang="ts">
import type { Release } from '@/api/plugins'
import { computed, h } from 'vue'
import { categoryLabel } from '@/lib/categories'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { formatDate } from '@/lib/time'
import { usePluginStore } from '@/stores/plugin'

const store = usePluginStore()
const plugin = computed(() => store.detail!.plugin)
const releases = computed(() => store.detail!.releases)

const columns = computed(() => [
  { title: $gettext('Version'), dataIndex: 'version', key: 'version' },
  { title: $gettext('Released'), dataIndex: 'releasedAt', key: 'releasedAt', render: (_: unknown, record: Release) => formatDate(record.releasedAt) },
  { title: $gettext('Requires Nginx UI'), dataIndex: 'minNginxUiVersion', key: 'min', render: (_: unknown, record: Release) => record.minNginxUiVersion ?? '' },
  {
    title: '',
    key: 'notes',
    render: (_: unknown, record: Release) => record.notesUrl
      ? h('a', { href: record.notesUrl, target: '_blank', rel: 'noopener' }, $gettext('Release notes'))
      : null,
  },
])
</script>

<template>
  <AFlex vertical gap="middle">
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
        </ADescriptionsItem>
        <ADescriptionsItem v-if="plugin.version" :label="$gettext('Latest version')">
          v{{ plugin.version }}
        </ADescriptionsItem>
      </ADescriptions>
    </ACard>
    <ACard :title="$gettext('Versions')">
      <ATable :columns="columns" :data-source="releases" row-key="version" :pagination="false" size="middle" :scroll="{ x: 560 }" />
    </ACard>
  </AFlex>
</template>
