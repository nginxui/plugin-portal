<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { changePath, kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { pluginSections } from '@/lib/pluginSections'
import { waited } from '@/lib/time'
import { useCrumbs } from '@/stores/crumbs'
import { usePluginStore } from '@/stores/plugin'

const route = useRoute()
const router = useRouter()
const store = usePluginStore()

const id = computed(() => String(route.params.id))
watch(id, value => store.open(value), { immediate: true })

const plugin = computed(() => store.detail?.plugin)
const name = computed(() => localized(plugin.value?.name))

const tabs = computed(() => pluginSections(router, id.value))

useCrumbs(() => [
  { title: $gettext('My plugins'), to: '/plugins' },
  ...(plugin.value ? [{ title: name.value, to: `/plugins/${id.value}` }] : []),
  ...(plugin.value ? [{ title: tabs.value.find(tab => tab.key === route.name)?.label ?? '' }] : []),
].filter(crumb => crumb.title))

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
    to: changePath(change),
    warn: change.waitingOn === 'author',
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
      <PluginHeader :plugin="plugin">
        <RouterLink v-if="strip" :to="strip.to" class="track-strip" :class="{ warn: strip.warn }">
          <span class="font-500 nowrap">{{ $gettext('Change in progress') }}</span>
          <span class="mini-track" aria-hidden="true"><span v-for="(state, i) in strip.track" :key="i" :class="state" /></span>
          <span class="flex-1 min-w-0 truncate">{{ strip.text }}</span>
          <span v-if="strip.more" class="text-3 op-65 nowrap">{{ $gettext('%{n} more', { n: String(strip.more) }) }}</span>
          <span class="track-link nowrap">{{ $gettext('View progress') }}<span class="i-tabler-chevron-right" /></span>
        </RouterLink>
      </PluginHeader>
      <RouterView />
    </template>
  </div>
</template>

<style scoped>
.track-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 24px;
  background: var(--portal-primary-bg);
  color: inherit;
  font-size: 13px;
}

.track-strip.warn {
  background: var(--portal-warn-bg);
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
  background: var(--portal-primary);
}

.mini-track .cur {
  background: #faad14;
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

  .track-strip {
    padding: 10px 16px;
  }
}
</style>
