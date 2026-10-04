<script setup lang="ts">
import type { PluginSummary } from '@/api/plugins'
import type { CatalogItem, QueueItem } from '@/api/review'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getMyPlugins } from '@/api/plugins'
import { getCatalog, getQueue } from '@/api/review'
import { kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { waited } from '@/lib/time'
import { usePaletteStore } from '@/stores/palette'
import { useSessionStore } from '@/stores/session'

interface Item {
  key: string
  group: string
  title: string
  sub: string
  to: string
  icon?: string
  plugin?: string
  avatar?: string
  search: string
}

const palette = usePaletteStore()
const session = useSessionStore()
const router = useRouter()
const input = useTemplateRef<HTMLInputElement>('input')
const list = useTemplateRef<HTMLElement>('list')

const query = ref('')
const active = ref(0)
const mine = ref<PluginSummary[]>([])
const queue = ref<QueueItem[]>([])
const catalog = ref<CatalogItem[]>([])

// Loaded on every open, so the lists follow the queue and new listings.
async function load() {
  const jobs: Promise<unknown>[] = [getMyPlugins().then(r => (mine.value = r.plugins)).catch(() => {})]
  if (session.isMaintainer) {
    jobs.push(
      getQueue().then(r => (queue.value = r.changes)).catch(() => {}),
      getCatalog().then(r => (catalog.value = r.plugins)).catch(() => {}),
    )
  }
  await Promise.all(jobs)
}

watch(() => palette.isOpen, async (open) => {
  if (!open)
    return
  query.value = ''
  active.value = 0
  load()
  await nextTick()
  input.value?.focus()
})

const GROUPS = computed(() => ({
  reviews: $gettext('Reviews'),
  plugins: $gettext('Plugins'),
  authors: $gettext('Authors'),
  actions: $gettext('Actions'),
}))

function stateText(state: string, yanked = false) {
  if (yanked)
    return $gettext('newest version yanked')
  if (state === 'listed')
    return $gettext('listed')
  if (state === 'delisted')
    return $gettext('delisted')
  return $gettext('in review')
}

const all = computed<Item[]>(() => {
  const g = GROUPS.value
  const items: Item[] = []
  for (const change of queue.value) {
    const name = localized(change.entry?.name) || change.pluginId || ''
    const risk = change.risk === 'high' ? $gettext('High risk') : change.waitingOn === 'author' ? $gettext('Waiting for the author') : $gettext('Waiting for review')
    items.push({
      key: `review:${change.id}`,
      group: g.reviews,
      title: $gettext('%{name}: %{kind}', { name, kind: kindLabel(change.kind) }),
      sub: $gettext('%{state}, waiting %{time}', { state: risk, time: waited(change.updatedAt) }),
      to: `/review/${change.id}`,
      plugin: name,
      search: `${name} ${change.pluginId} ${change.author} ${kindLabel(change.kind)}`,
    })
  }
  const seen = new Set<string>()
  for (const plugin of mine.value) {
    seen.add(plugin.id)
    const name = localized(plugin.name) || plugin.id
    items.push({ key: `plugin:${plugin.id}`, group: g.plugins, title: name, sub: $gettext('%{id}, %{state}', { id: plugin.id, state: stateText(plugin.state) }), to: `/plugins/${plugin.id}`, plugin: name, search: `${name} ${plugin.id} ${plugin.owner?.login ?? ''}` })
  }
  for (const plugin of catalog.value) {
    if (seen.has(plugin.id))
      continue
    const name = localized(plugin.name ?? undefined) || plugin.id
    items.push({ key: `plugin:${plugin.id}`, group: g.plugins, title: name, sub: $gettext('%{id}, %{state}', { id: plugin.id, state: stateText(plugin.state, plugin.yanked) }), to: `/plugins/${plugin.id}`, plugin: name, search: `${name} ${plugin.id} ${plugin.owner ?? ''}` })
  }
  const owners = new Map<string, number>()
  for (const plugin of catalog.value) {
    if (plugin.owner)
      owners.set(plugin.owner, (owners.get(plugin.owner) ?? 0) + 1)
  }
  for (const [login, count] of owners) {
    items.push({
      key: `author:${login}`,
      group: g.authors,
      title: `@${login}`,
      sub: $gettext('%{n} plugins, their actions in the audit log', { n: String(count) }),
      to: `/audit?actor=${encodeURIComponent(login)}`,
      avatar: login,
      search: login,
    })
  }
  const pages: [string, string, string, string][] = [
    ['/plugins', 'i-tabler-layout-grid', $gettext('My plugins'), $gettext('Plugins you manage')],
    ['/submit', 'i-tabler-plus', $gettext('Submit a plugin'), $gettext('List a new plugin in the catalog')],
    ['/owners', 'i-tabler-building', $gettext('Organizations'), $gettext('Owners of your plugins')],
  ]
  if (session.isMaintainer) {
    pages.push(
      ['/review', 'i-tabler-inbox', $gettext('Review queue'), $gettext('Changes waiting for a review')],
      ['/audit', 'i-tabler-history', $gettext('Audit log'), $gettext('Every action in the developer portal')],
    )
  }
  for (const [to, icon, title, sub] of pages)
    items.push({ key: `page:${to}`, group: g.actions, title, sub, to, icon, search: `${title} ${sub}` })
  return items
})

const LIMIT = 5

const shown = computed<Item[]>(() => {
  const q = query.value.trim().toLowerCase()
  const g = GROUPS.value
  const out: Item[] = []
  for (const group of [g.reviews, g.plugins, g.authors, g.actions]) {
    let items = all.value.filter(i => i.group === group)
    if (q)
      items = items.filter(i => i.search.toLowerCase().includes(q))
    // Without a query only what usually comes next: open reviews and pages.
    else if (group === g.plugins || group === g.authors)
      items = []
    out.push(...items.slice(0, group === g.actions ? 10 : LIMIT))
    if (group === g.actions && q && session.isMaintainer) {
      out.push({
        key: 'audit-search',
        group,
        title: $gettext('Search the audit log for “%{q}”', { q: query.value.trim() }),
        sub: $gettext('Reviews, self service changes and catalog updates'),
        to: `/audit?q=${encodeURIComponent(query.value.trim())}`,
        icon: 'i-tabler-history',
        search: '',
      })
      out.push({
        key: 'block',
        group,
        title: $gettext('Add a plugin to the block list'),
        sub: $gettext('A reason is required'),
        to: `/maintain/plugins?block=${encodeURIComponent(query.value.trim())}`,
        icon: 'i-tabler-ban',
        search: '',
      })
    }
  }
  return out
})

const grouped = computed(() => {
  const groups: { name: string, items: { item: Item, index: number }[] }[] = []
  shown.value.forEach((item, index) => {
    const last = groups[groups.length - 1]
    if (last?.name === item.group)
      last.items.push({ item, index })
    else
      groups.push({ name: item.group, items: [{ item, index }] })
  })
  return groups
})

watch(query, () => {
  active.value = 0
})

function move(step: number) {
  const n = shown.value.length
  if (!n)
    return
  active.value = (active.value + step + n) % n
  nextTick(() => list.value?.querySelector('.item.on')?.scrollIntoView({ block: 'nearest' }))
}

function go(item: Item | undefined, newTab = false) {
  if (!item)
    return
  palette.hide()
  if (newTab)
    window.open(router.resolve(item.to).href, '_blank', 'noopener')
  else
    router.push(item.to)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  }
  else if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault()
    go(shown.value[active.value], e.metaKey || e.ctrlKey)
  }
}
</script>

<template>
  <AModal
    :open="palette.isOpen"
    :footer="null"
    :closable="false"
    :width="640"
    :style="{ top: '12vh' }"
    :styles="{ container: { padding: 0, overflow: 'hidden' } }"
    :aria-label="$gettext('Command palette')"
    destroy-on-hidden
    @cancel="palette.hide()"
  >
    <div class="palette" @keydown="onKeydown">
      <div class="field">
        <span class="i-tabler-search text-5 op-50" />
        <input
          ref="input"
          v-model="query"
          class="input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          :aria-activedescendant="shown[active] ? `palette-${active}` : undefined"
          :placeholder="session.isMaintainer ? $gettext('Search reviews, plugins, authors and actions') : $gettext('Search plugins and actions')"
          :aria-label="$gettext('Search')"
        >
        <kbd>esc</kbd>
      </div>
      <div id="palette-list" ref="list" class="list" role="listbox">
        <template v-for="group in grouped" :key="group.name">
          <div class="group">
            {{ group.name }}
          </div>
          <div
            v-for="{ item, index } in group.items"
            :id="`palette-${index}`"
            :key="item.key"
            class="item"
            :class="{ on: index === active }"
            role="option"
            :aria-selected="index === active"
            @mousemove="active = index"
            @click="go(item, $event.metaKey || $event.ctrlKey)"
          >
            <PluginIcon v-if="item.plugin" :name="item.plugin" :size="28" />
            <AAvatar v-else-if="item.avatar" :size="28">
              {{ item.avatar.slice(0, 1).toUpperCase() }}
            </AAvatar>
            <span v-else class="action-icon"><span :class="item.icon" /></span>
            <div class="min-w-0 flex-1">
              <div class="ellipsis">
                {{ item.title }}
              </div>
              <div class="text-3 op-65 ellipsis">
                {{ item.sub }}
              </div>
            </div>
            <span v-if="index === active" class="text-3 op-65 nowrap">{{ $gettext('↵ Open') }}</span>
          </div>
        </template>
        <div v-if="shown.length === 0" class="empty">
          {{ $gettext('Nothing matches “%{q}”.', { q: query.trim() }) }}
        </div>
      </div>
      <div class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd>{{ $gettext('Select') }}</span>
        <span><kbd>↵</kbd>{{ $gettext('Open') }}</span>
        <span><kbd>{{ palette.modifier }}</kbd><kbd>↵</kbd>{{ $gettext('Open in a new tab') }}</span>
      </div>
    </div>
  </AModal>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--portal-border);
}

.input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font-size: 16px;
}

.list {
  max-height: min(56vh, 480px);
  overflow-y: auto;
  padding: 6px 0;
}

.group {
  padding: 10px 16px 4px;
  font-size: 12px;
  opacity: 0.55;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 6px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.item.on {
  background: var(--portal-primary-bg);
}

.action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--portal-border);
  background: var(--portal-faint);
  font-size: 16px;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nowrap {
  white-space: nowrap;
}

.empty {
  padding: 32px 16px;
  text-align: center;
  opacity: 0.6;
}

.foot {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 10px 16px;
  border-top: 1px solid var(--portal-border);
  font-size: 12px;
  opacity: 0.7;
}

.foot span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

kbd {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  border: 1px solid var(--portal-border-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: center;
}
</style>
