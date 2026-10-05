<script setup lang="ts">
import type { MarketEntry } from '@nginxui/plugin-market-ui'
import type { Draft } from '@/api/submit'
import { MarketCard } from '@nginxui/plugin-market-ui'
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'

// The submission as the marketplace list of Nginx UI will show it.
const props = defineProps<{ draft: Draft }>()

const gettext = useGettext()

const entry = computed<MarketEntry>(() => ({
  id: props.draft.id,
  name: props.draft.name,
  description: props.draft.description,
  author: props.draft.repo.split('/')[0],
  trust: 'community',
  installable_release: { version: props.draft.version },
}))
</script>

<template>
  <MarketCard :entry="entry" :locale="gettext.current" />
</template>
