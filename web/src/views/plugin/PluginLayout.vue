<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { $gettext } from '@/lib/gettext'
import { localized, roleLabel, stateTag, trustLabel } from '@/lib/labels'
import { usePluginStore } from '@/stores/plugin'

const route = useRoute()
const router = useRouter()
const store = usePluginStore()

const id = computed(() => String(route.params.id))
watch(id, value => store.open(value), { immediate: true })

const plugin = computed(() => store.detail?.plugin)
const name = computed(() => localized(plugin.value?.name))

const crumbs = computed(() => [
  {
    title: $gettext('My plugins'),
    href: '/plugins',
    onClick: (e: MouseEvent) => {
      e.preventDefault()
      router.push('/plugins')
    },
  },
  { title: name.value },
])

const tabs = computed(() => [
  { key: 'plugin', label: $gettext('Overview'), to: `/plugins/${id.value}` },
  { key: 'plugin-versions', label: $gettext('Versions'), to: `/plugins/${id.value}/versions` },
  { key: 'plugin-access', label: $gettext('Access'), to: `/plugins/${id.value}/access` },
])
</script>

<template>
  <div class="page">
    <AResult
      v-if="store.error === 'no_access'"
      status="403"
      :title="$gettext('You have no access to this plugin')"
      :sub-title="$gettext('Access follows your permission on the plugin repository on GitHub.')"
    />
    <AResult
      v-else-if="store.error"
      status="404"
      :title="$gettext('Plugin not found')"
      :sub-title="$gettext('No listing or draft has this plugin ID.')"
    />
    <ASkeleton v-else-if="!plugin" active avatar />
    <template v-else>
      <ABreadcrumb :items="crumbs" />
      <AFlex gap="middle" align="center" wrap>
        <PluginIcon :src="plugin.iconUrl" :name="name" :size="56" />
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
          </AFlex>
          <AFlex gap="small" wrap class="text-3 op-65">
            <span class="mono">{{ plugin.id }}</span>
            <span v-if="plugin.version">v{{ plugin.version }}</span>
            <span>{{ roleLabel(plugin.role) }}</span>
          </AFlex>
        </div>
        <AFlex gap="small" wrap>
          <AButton v-if="plugin.catalogUrl" :href="plugin.catalogUrl" target="_blank">
            {{ $gettext('View in catalog') }}
          </AButton>
          <AButton v-if="plugin.repo" :href="`https://github.com/${plugin.repo}`" target="_blank">
            <span class="i-tabler-brand-github" />
            {{ $gettext('Repository') }}
          </AButton>
        </AFlex>
      </AFlex>
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
      <RouterView />
    </template>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 24px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  /* The bottom line is drawn inside, so the underline of the open tab can
     cover it without overflowing and making the bar scroll. */
  box-shadow: inset 0 -1px 0 var(--portal-border);
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
</style>
