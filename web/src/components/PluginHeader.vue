<script setup lang="ts">
import type { PluginSummary } from '@/api/plugins'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { localized, roleLabel, stateTag, trustLabel } from '@/lib/labels'
import { pluginSections } from '@/lib/pluginSections'

// The head of a plugin: its card with the plugin sections, shared by the
// plugin pages and the change pages. The default slot sits above the tabs.

const props = defineProps<{ plugin: PluginSummary }>()

const route = useRoute()
const router = useRouter()
const name = computed(() => localized(props.plugin.name))
const tabs = computed(() => pluginSections(router, props.plugin.id))
</script>

<template>
  <div class="head-card">
    <AFlex gap="middle" align="center" wrap class="head">
      <PluginIcon :src="plugin.iconUrl" :name="name" :size="64" />
      <div class="flex-1 min-w-0">
        <AFlex gap="small" align="center" wrap>
          <h1 class="page-title m-0">
            {{ name }}
          </h1>
          <ATag :color="stateTag(plugin.state).color" class="m-0">
            {{ stateTag(plugin.state).label }}
          </ATag>
          <ATag v-if="trustLabel(plugin.trust)" class="m-0">
            {{ trustLabel(plugin.trust) }}
          </ATag>
          <ATag v-if="plugin.version" class="m-0">
            v{{ plugin.version }}
          </ATag>
        </AFlex>
        <AFlex gap="small" wrap class="text-3 op-65 mt-1">
          <span class="mono">{{ plugin.id }}</span>
          <span v-if="plugin.role">{{ roleLabel(plugin.role) }}</span>
        </AFlex>
      </div>
      <AFlex gap="small" wrap>
        <AButton v-if="plugin.catalogUrl" :href="plugin.catalogUrl" target="_blank">
          <span class="i-tabler-external-link" />
          {{ $gettext('View in catalog') }}
        </AButton>
        <AButton v-if="plugin.repo" :href="`https://github.com/${plugin.repo}`" target="_blank">
          <span class="i-tabler-brand-github" />
          {{ $gettext('Repository') }}
        </AButton>
      </AFlex>
    </AFlex>
    <slot />
    <nav class="tabs" :aria-label="$gettext('Plugin sections')">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.key"
        :to="tab.to"
        class="tab"
        :class="{ on: route.name === tab.key }"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.head-card {
  background: var(--portal-card);
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  overflow: hidden;
}

.head {
  padding: 24px 24px 20px;
}

.tabs {
  display: flex;
  gap: 32px;
  padding: 0 24px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  padding: 12px 0;
  color: inherit;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
}

.tab.on {
  color: var(--portal-primary);
  border-color: var(--portal-primary);
  font-weight: 500;
}

@media (max-width: 640px) {
  .head {
    padding: 16px;
  }

  .tabs {
    gap: 24px;
    padding: 0 16px;
  }
}
</style>
