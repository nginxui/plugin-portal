<script setup lang="ts">
import type { NotificationItem } from '@/api/notifications'
import { useIntervalFn } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { clearNotifications, getNotifications, markRead } from '@/api/notifications'
import { changePath, kindLabel } from '@/lib/changeKinds'
import { useFailure } from '@/lib/feedback'
import { $gettext } from '@/lib/gettext'
import { joinClauses, localized } from '@/lib/labels'
import { fromNow } from '@/lib/time'

// What happened to the user's changes, by others or by the catalog: one row
// per change with its newest step, those waiting for the user first.
const router = useRouter()
const items = ref<NotificationItem[]>([])
const enabled = ref(true)
const open = ref(false)
const view = ref<'list' | 'prefs'>('list')

async function load() {
  try {
    const data = await getNotifications()
    items.value = data.items
    enabled.value = data.inApp !== false
  }
  catch {}
}
onMounted(load)
useIntervalFn(load, 120000)

interface Row {
  item: NotificationItem
  unread: boolean
}

// The newest step of each change; its earlier steps are on the change page.
const rows = computed<Row[]>(() => {
  const byChange = new Map<string, Row>()
  for (const item of items.value) {
    const row = byChange.get(item.change)
    if (row)
      row.unread ||= item.unread
    else
      byChange.set(item.change, { item, unread: item.unread })
  }
  return [...byChange.values()]
})

const waitsForUser = (row: Row) => row.item.changeState === 'open' && row.item.waitingOn === 'author'
const todo = computed(() => rows.value.filter(waitsForUser))
const rest = computed(() => rows.value.filter(row => !waitsForUser(row)))
const sections = computed(() => [
  { key: 'todo', title: $gettext('Waiting for you'), rows: todo.value },
  { key: 'rest', title: todo.value.length ? $gettext('Other progress') : $gettext('Recent progress'), rows: rest.value },
].filter(section => section.rows.length))

// Unread rows keep their mark while the list is open; the count clears.
const seen = ref(false)
const unread = computed(() => seen.value ? 0 : rows.value.filter(row => row.unread).length)

async function onOpen(value: boolean) {
  open.value = value
  if (value && unread.value) {
    seen.value = true
    await markRead().catch(() => {})
  }
}

// Once closed, the list is read again, so what was unread shows as read.
function afterOpenChange(value: boolean) {
  if (value)
    return
  view.value = 'list'
  if (seen.value) {
    seen.value = false
    load()
  }
}

// Clears the progress shown; what waits for the user stays until it is dealt
// with, and every change keeps its history on its page.
const failure = useFailure()
const clearing = ref(false)
async function clear() {
  clearing.value = true
  try {
    await clearNotifications()
    seen.value = false
    await load()
  }
  catch {
    failure()
  }
  finally {
    clearing.value = false
  }
}

const inRepository = (item: NotificationItem) => item.kind === 'store' || item.kind === 'translations'

function title(item: NotificationItem): string {
  const who = item.actor ? `@${item.actor}` : ''
  switch (item.stage) {
    case 'review':
      if (inRepository(item))
        return item.detail?.prNumber ? $gettext('Pull request #%{n} is open, ready for you to merge', { n: String(item.detail.prNumber) }) : $gettext('The files are ready for you to commit')
      return $gettext('The checks passed, waiting for a maintainer')
    case 'checks':
      return item.detail?.outcome === 'checks_failed' || item.detail?.outcome === 'rejected' ? $gettext('The checks found problems') : $gettext('The checks could not finish')
    case 'changes_requested': return who ? $gettext('%{who} asked for changes', { who }) : $gettext('A maintainer asked for changes')
    case 'merged':
      if (item.class === 'self_service' && !inRepository(item))
        return $gettext('Committed to the catalog')
      return who ? $gettext('%{who} approved and merged it', { who }) : $gettext('It was merged')
    case 'live': return $gettext('It is live in the catalog')
    case 'rejected': return who ? $gettext('%{who} rejected it', { who }) : $gettext('The pull request was closed')
    case 'reminder': return $gettext('Still waiting for you')
    case 'withdrawn': return $gettext('It was withdrawn')
    case 'batch': return $gettext('More translations were added to the pull request')
    default: return kindLabel(item.kind)
  }
}

// What a maintainer wrote, for a request or a rejection.
const quote = (item: NotificationItem) => (item.stage === 'changes_requested' || item.stage === 'rejected') && typeof item.detail?.comment === 'string' ? item.detail.comment : ''

function mark(row: Row): { tone: string, icon: string } {
  const { item } = row
  if (item.stage === 'rejected')
    return { tone: 'bad', icon: 'i-tabler-x' }
  if (item.stage === 'withdrawn')
    return { tone: 'muted', icon: 'i-tabler-arrow-back-up' }
  if (item.stage === 'merged' || item.stage === 'live')
    return { tone: 'ok', icon: 'i-tabler-check' }
  if (waitsForUser(row) || item.stage === 'checks')
    return { tone: 'warn', icon: 'i-tabler-exclamation-mark' }
  return { tone: 'info', icon: 'i-tabler-clock' }
}

const subject = (item: NotificationItem) => joinClauses([localized(item.name ?? undefined) || item.pluginId || '', item.number ? `${kindLabel(item.kind)} #${item.number}` : kindLabel(item.kind)].filter(Boolean))

function go(item: NotificationItem) {
  open.value = false
  router.push(changePath({ id: item.change, number: item.number }))
}
</script>

<template>
  <APopover :open="open" trigger="click" placement="bottomRight" :arrow="false" :styles="{ container: { padding: 0 } }" :after-open-change="afterOpenChange" @open-change="onOpen">
    <AButton type="text" :aria-label="$gettext('Notifications')">
      <!-- A count for what is new; a quiet dot while something waits for the user. -->
      <ABadge :count="unread" :dot="!unread && todo.length > 0" :color="unread ? undefined : '#faad14'" size="small" :offset="[2, -2]">
        <span class="i-tabler-bell text-4" />
      </ABadge>
    </AButton>
    <template #content>
      <div class="panel">
        <div class="head">
          <template v-if="view === 'list'">
            <span class="head-title">{{ $gettext('Notifications') }}</span>
            <AButton type="text" size="small" :aria-label="$gettext('Notification settings')" @click="view = 'prefs'">
              <span class="i-tabler-settings text-4" />
            </AButton>
          </template>
          <template v-else>
            <AButton type="text" size="small" :aria-label="$gettext('Back to the notifications')" @click="view = 'list'">
              <span class="i-tabler-arrow-left text-4" />
            </AButton>
            <span class="head-title">{{ $gettext('Notification settings') }}</span>
          </template>
        </div>

        <div v-if="view === 'prefs'" class="settings">
          <NotificationPrefs @changed="load" />
        </div>

        <div v-else-if="!enabled" class="empty">
          <span class="i-tabler-bell-off empty-icon" />
          <div>{{ $gettext('Notifications in the Developer Center are turned off.') }}</div>
          <AButton size="small" class="mt-2" @click="view = 'prefs'">
            {{ $gettext('Notification settings') }}
          </AButton>
        </div>

        <div v-else-if="!rows.length" class="empty">
          <span class="i-tabler-bell empty-icon" />
          <div>{{ $gettext('No notifications yet.') }}</div>
          <div class="text-3 op-65">
            {{ $gettext('Progress of your submissions and changes shows here.') }}
          </div>
        </div>

        <div v-else class="list">
          <template v-for="section in sections" :key="section.key">
            <div class="section" :class="section.key">
              <span>{{ section.title }}</span>
              <span v-if="section.key === 'todo'" class="count">{{ section.rows.length }}</span>
              <button v-else type="button" class="clear" :disabled="clearing" @click="clear">
                {{ $gettext('Clear the list') }}
              </button>
            </div>
            <button v-for="row in section.rows" :key="row.item.id" type="button" class="item" :class="{ unread: row.unread }" @click="go(row.item)">
              <span class="avatar">
                <PluginIcon :src="row.item.iconUrl" :name="localized(row.item.name ?? undefined) || row.item.pluginId || ''" :size="36" />
                <span class="mark" :class="mark(row).tone"><span :class="mark(row).icon" /></span>
              </span>
              <span class="body">
                <span class="title">{{ title(row.item) }}</span>
                <span class="subject">{{ subject(row.item) }}</span>
                <span v-if="quote(row.item)" class="quote">{{ quote(row.item) }}</span>
              </span>
              <span class="meta">
                <span class="time">{{ fromNow(row.item.at) }}</span>
                <span v-if="row.unread" class="dot" role="img" :aria-label="$gettext('Unread')" />
              </span>
            </button>
          </template>
        </div>
      </div>
    </template>
  </APopover>
</template>

<style scoped>
.panel {
  width: min(380px, calc(100vw - 32px));
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 48px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--portal-border);
}

.head-title {
  flex: 1;
  font-weight: 600;
}

.settings {
  padding: 16px;
}

.list {
  max-height: min(480px, calc(100vh - 160px));
  overflow-y: auto;
  padding: 6px;
}

.section {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 4px;
  font-size: 12px;
}

.section.todo {
  color: var(--portal-warn-text);
  font-weight: 500;
}

.section.rest > span {
  opacity: 0.65;
}

.clear {
  all: unset;
  margin-inline-start: auto;
  padding: 0 6px;
  border-radius: 4px;
  color: var(--portal-primary);
  cursor: pointer;
}

.clear:hover,
.clear:focus-visible {
  background: var(--portal-faint);
}

.clear:disabled {
  opacity: 0.5;
  cursor: default;
}

.count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--portal-warn-bg);
  box-shadow: inset 0 0 0 1px var(--portal-warn-border);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}

.item {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
}

.item:hover,
.item:focus-visible {
  background: var(--portal-faint);
}

.item:focus-visible {
  outline: 2px solid var(--portal-primary);
  outline-offset: -2px;
}

.avatar {
  position: relative;
  flex: none;
  display: inline-flex;
}

/* How the step went, on the corner of the plugin icon. */
.mark {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--portal-primary);
  box-shadow: 0 0 0 2px var(--ant-color-bg-elevated, var(--portal-card));
  color: #fff;
  font-size: 10px;
}

.mark.ok {
  background: #52c41a;
}

.mark.warn {
  background: #faad14;
}

.mark.bad {
  background: #ff4d4f;
}

.mark.muted {
  background: #8c8c8c;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  line-height: 20px;
}

.item.unread .title {
  font-weight: 600;
}

.subject {
  font-size: 12px;
  opacity: 0.65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quote {
  display: -webkit-box;
  margin-top: 4px;
  padding-inline-start: 8px;
  border-inline-start: 2px solid var(--portal-border-strong);
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 12px;
  opacity: 0.85;
  overflow-wrap: anywhere;
}

.meta {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.time {
  font-size: 12px;
  line-height: 20px;
  opacity: 0.5;
  white-space: nowrap;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--portal-primary);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 36px 24px;
  text-align: center;
}

.empty-icon {
  margin-bottom: 6px;
  font-size: 28px;
  opacity: 0.35;
}
</style>
