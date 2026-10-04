<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { localized, roleLabel, stateTag, trustLabel } from '@/lib/labels'
import { waited } from '@/lib/time'
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

// Sections in the order of the design; a section shows once its page exists.
const tabs = computed(() => [
  { key: 'plugin', label: $gettext('Store'), path: '' },
  { key: 'plugin-screenshots', label: $gettext('Screenshots'), path: '/screenshots' },
  { key: 'plugin-translations', label: $gettext('Translations'), path: '/translations' },
  { key: 'plugin-preflight', label: $gettext('Preflight'), path: '/preflight' },
  { key: 'plugin-versions', label: $gettext('Versions'), path: '/versions' },
  { key: 'plugin-badges', label: $gettext('Badges'), path: '/badges' },
  { key: 'plugin-signers', label: $gettext('Signers'), path: '/signers' },
  { key: 'plugin-access', label: $gettext('Access'), path: '/access' },
].filter(tab => router.hasRoute(tab.key)).map(tab => ({ ...tab, to: `/plugins/${id.value}${tab.path}` })))

// The newest change still on its way, as one line with its progress.
const STAGES = ['submitted', 'checks', 'review', 'merged', 'live']
const strip = computed(() => {
  const change = store.detail?.openChanges?.[0]
  if (!change)
    return null
  const at = STAGES.indexOf(change.stage)
  let text: string
  if (change.waitingOn === 'author' && change.stage === 'checks')
    text = $gettext('%{kind}, the checks found problems', { kind: kindLabel(change.kind) })
  else if (change.waitingOn === 'author' && change.class === 'self_service')
    text = $gettext('%{kind}, waiting for you to merge pull request #%{n}', { kind: kindLabel(change.kind), n: String(change.prNumber ?? '') })
  else if (change.waitingOn === 'author')
    text = $gettext('%{kind}, a maintainer asked for changes', { kind: kindLabel(change.kind) })
  else if (change.stage === 'review')
    text = $gettext('%{kind}, waiting for a maintainer to review', { kind: kindLabel(change.kind) })
  else if (change.stage === 'merged')
    text = $gettext('%{kind}, takes effect at the next catalog update', { kind: kindLabel(change.kind) })
  else
    text = $gettext('%{kind}, being checked', { kind: kindLabel(change.kind) })
  return {
    id: change.id,
    text: $gettext('%{text}, waiting %{time}', { text, time: waited(change.updatedAt) }),
    track: STAGES.map((_, i) => i < at ? 'done' : i === at ? (change.waitingOn === 'author' ? 'warn' : 'cur') : ''),
    more: (store.detail?.openChanges?.length ?? 1) - 1,
  }
})
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
      <RouterLink v-if="strip" :to="`/changes/${strip.id}`" class="track-strip">
        <span class="font-500 nowrap">{{ $gettext('Change in progress') }}</span>
        <span class="mini-track" aria-hidden="true"><span v-for="(state, i) in strip.track" :key="i" :class="state" /></span>
        <span class="flex-1 min-w-0 truncate">{{ strip.text }}</span>
        <span v-if="strip.more" class="text-3 op-65 nowrap">{{ $gettext('%{n} more', { n: String(strip.more) }) }}</span>
        <span class="track-link nowrap">{{ $gettext('View progress') }}<span class="i-tabler-chevron-right" /></span>
      </RouterLink>
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
.track-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  background: var(--portal-primary-bg);
  color: inherit;
  font-size: 13px;
}

.track-strip:hover .track-link {
  text-decoration: underline;
}

.mini-track {
  display: inline-flex;
  gap: 3px;
  flex: none;
}

.mini-track span {
  width: 14px;
  height: 4px;
  border-radius: 2px;
  background: var(--portal-border-strong);
}

.mini-track .done {
  background: #52c41a;
}

.mini-track .cur {
  background: var(--portal-primary);
}

.mini-track .warn {
  background: #faad14;
}

.track-link {
  display: inline-flex;
  align-items: center;
  color: var(--portal-primary);
}

.nowrap {
  white-space: nowrap;
}

@media (max-width: 640px) {
  .mini-track {
    display: none;
  }
}

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
