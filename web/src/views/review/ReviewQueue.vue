<script setup lang="ts">
import type { QueueItem, RecentChange } from '@/api/review'
import { onKeyStroke } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { approveBatch, approveChange, getQueue, requestChanges } from '@/api/review'
import { kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { fromNow, waited } from '@/lib/time'
import { usePaletteStore } from '@/stores/palette'
import { useReviewStore } from '@/stores/review'

const router = useRouter()
const reviewStore = useReviewStore()
const palette = usePaletteStore()
const items = ref<QueueItem[]>([])
const recent = ref<RecentChange[]>([])
const done = ref<QueueItem[]>([])
const kindFilter = ref<string>('')
const loading = ref(true)
const failed = ref(false)
const filter = ref<'maintainer' | 'author' | 'done' | 'all'>('maintainer')
const search = ref('')
const focus = ref(0)
const searchInput = ref<{ focus: () => void } | null>(null)

// Acting from the queue: only a change in review, and high risk changes
// only from their own page.
const inReview = (item: QueueItem) => item.state === 'open' && item.stage === 'review' && item.waitingOn === 'maintainer'
const batchable = (item: QueueItem) => inReview(item) && item.risk !== 'high'

const selected = ref<string[]>([])
const selectedItems = computed(() => items.value.filter(i => selected.value.includes(i.id)))

async function load() {
  try {
    const queue = await getQueue()
    items.value = queue.changes
    recent.value = queue.recent
    done.value = queue.done ?? []
    reviewStore.count(items.value)
    selected.value = selected.value.filter(id => items.value.some(i => i.id === id && batchable(i)))
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

const count = (waitingOn: string) => items.value.filter(i => i.waitingOn === waitingOn).length

const filters = computed(() => [
  { value: 'maintainer', label: `${$gettext('Waiting for review')} ${count('maintainer')}` },
  { value: 'author', label: `${$gettext('Waiting for the author')} ${count('author')}` },
  { value: 'done', label: $gettext('Finished') },
  { value: 'all', label: $gettext('All in progress') },
])

const kindOptions = computed(() => [
  { value: '', label: $gettext('All kinds') },
  ...[...new Set([...items.value, ...done.value].map(i => i.kind))].map(kind => ({ value: kind, label: kindLabel(kind) })),
])

// Three levels for the eye: high risk, a change that needs a careful look,
// and a low risk one that may be approved with others.
const HIGH_RISK = ['key', 'trust', 'block', 'delisting']
const LOW_RISK = ['repository', 'translations', 'store', 'categories']
function riskLevel(item: QueueItem): 'high' | 'medium' | 'low' {
  if (HIGH_RISK.includes(item.kind) || (item.risk === 'high' && item.kind !== 'new_listing'))
    return 'high'
  return LOW_RISK.includes(item.kind) ? 'low' : 'medium'
}
const RISK_ORDER = { high: 0, medium: 1, low: 2 }

// High risk first, then the longest waiting.
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (filter.value === 'done') {
    return done.value
      .filter(i => !kindFilter.value || i.kind === kindFilter.value)
      .filter(i => !q || i.pluginId?.toLowerCase().includes(q) || i.author?.toLowerCase().includes(q) || localized(i.entry?.name).toLowerCase().includes(q))
  }
  return items.value
    .filter(i => filter.value === 'all' || i.waitingOn === filter.value)
    .filter(i => !kindFilter.value || i.kind === kindFilter.value)
    .filter(i => !q || i.pluginId?.toLowerCase().includes(q) || i.author?.toLowerCase().includes(q) || localized(i.entry?.name).toLowerCase().includes(q))
    .sort((a, b) => RISK_ORDER[riskLevel(a)] - RISK_ORDER[riskLevel(b)] || a.updatedAt - b.updatedAt)
})

watch(shown, () => {
  focus.value = Math.min(focus.value, Math.max(shown.value.length - 1, 0))
})

const batchableShown = computed(() => shown.value.filter(batchable))
const allSelected = computed(() => batchableShown.value.length > 0 && batchableShown.value.every(i => selected.value.includes(i.id)))

// Changes that need the closest look stand out in the queue.
function kindColor(kind: string): string {
  if (kind === 'key' || kind === 'block' || kind === 'delisting')
    return 'gold'
  return kind === 'new_listing' ? 'blue' : 'default'
}

const checkIcon: Record<string, string> = { ok: 'i-tabler-circle-check', fail: 'i-tabler-circle-x', run: 'i-tabler-clock' }

function checkState(item: QueueItem): { tone: string, text: string } {
  if (item.stage === 'checks' && item.waitingOn === 'system' && !item.outcome)
    return { tone: 'run', text: $gettext('Running') }
  if (item.stage === 'checks')
    return { tone: 'fail', text: $gettext('Failed') }
  return { tone: 'ok', text: $gettext('Passed check') }
}

function open(item: QueueItem | undefined, newTab = false) {
  if (!item)
    return
  if (newTab)
    window.open(router.resolve(`/review/${item.id}`).href, '_blank', 'noopener')
  else
    router.push(`/review/${item.id}`)
}

function toggle(item: QueueItem, on = !selected.value.includes(item.id)) {
  if (!batchable(item))
    return
  selected.value = on ? [...selected.value, item.id] : selected.value.filter(id => id !== item.id)
}

function toggleAll(on: boolean) {
  selected.value = on ? batchableShown.value.map(i => i.id) : []
}

type Action = { kind: 'approve', item: QueueItem } | { kind: 'request', item: QueueItem } | { kind: 'batch', items: QueueItem[] }
const action = ref<Action | null>(null)
const comment = ref('')
const sending = ref(false)
const actionError = ref('')
const notice = ref<{ type: 'success' | 'warning', text: string } | null>(null)

function start(next: Action) {
  action.value = next
  comment.value = ''
  actionError.value = ''
}

function approveFocused() {
  const item = shown.value[focus.value]
  if (!item || !inReview(item))
    return
  if (item.risk === 'high')
    open(item)
  else
    start({ kind: 'approve', item })
}

function requestFocused() {
  const item = shown.value[focus.value]
  if (item && inReview(item))
    start({ kind: 'request', item })
}

function approveSelected() {
  if (selectedItems.value.length)
    start({ kind: 'batch', items: selectedItems.value })
}

const actionTitle = computed(() => {
  const a = action.value
  if (!a)
    return ''
  if (a.kind === 'batch')
    return $gettext('Approve %{n} changes', { n: String(a.items.length) })
  const name = localized(a.item.entry?.name) || a.item.pluginId || ''
  return a.kind === 'approve' ? $gettext('Approve %{name}', { name }) : $gettext('Request changes on %{name}', { name })
})

async function confirmAction() {
  const a = action.value
  if (!a)
    return
  if (a.kind === 'request' && !comment.value.trim()) {
    actionError.value = $gettext('Tell the author what to change.')
    return
  }
  sending.value = true
  actionError.value = ''
  try {
    if (a.kind === 'approve') {
      await approveChange(a.item.id, comment.value)
      notice.value = { type: 'success', text: $gettext('Merged. The change takes effect at the next catalog update.') }
    }
    else if (a.kind === 'request') {
      await requestChanges(a.item.id, comment.value)
      notice.value = { type: 'success', text: $gettext('The author was asked for changes.') }
    }
    else {
      const { results } = await approveBatch(a.items.map(i => i.id))
      const merged = Object.values(results).filter(r => r === 'merged').length
      const left = a.items.length - merged
      notice.value = left
        ? { type: 'warning', text: $gettext('%{merged} merged, %{left} could not be merged and stay in the queue.', { merged: String(merged), left: String(left) }) }
        : { type: 'success', text: $gettext('%{n} changes merged.', { n: String(merged) }) }
      selected.value = []
    }
    action.value = null
    await load()
  }
  catch (error) {
    actionError.value = error instanceof ApiError && error.code === 'merge_refused'
      ? $gettext('GitHub refused the merge. The pull request may have conflicts or failing checks.')
      : $gettext('The action could not be completed. Please try again.')
  }
  finally {
    sending.value = false
  }
}

function recentName(change: RecentChange) {
  return localized(change.entry?.name) || change.pluginId || ''
}

// Keys are off while typing or while a dialog or the palette is open.
function typing(e: KeyboardEvent) {
  return palette.isOpen || !!action.value || e.metaKey || e.ctrlKey || e.altKey
    || (e.target instanceof HTMLElement && (/^(?:INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable))
}

onKeyStroke(['j', 'ArrowDown'], (e) => {
  if (typing(e))
    return
  e.preventDefault()
  focus.value = Math.min(focus.value + 1, shown.value.length - 1)
})
onKeyStroke(['k', 'ArrowUp'], (e) => {
  if (typing(e))
    return
  e.preventDefault()
  focus.value = Math.max(focus.value - 1, 0)
})
onKeyStroke('Enter', (e) => {
  if (!typing(e))
    open(shown.value[focus.value])
})
onKeyStroke('x', (e) => {
  const item = shown.value[focus.value]
  if (typing(e) || !item)
    return
  e.preventDefault()
  toggle(item)
})
onKeyStroke('a', (e) => {
  if (typing(e))
    return
  e.preventDefault()
  approveFocused()
})
onKeyStroke('A', (e) => {
  if (typing(e) || !e.shiftKey)
    return
  e.preventDefault()
  approveSelected()
})
onKeyStroke('r', (e) => {
  if (typing(e))
    return
  e.preventDefault()
  requestFocused()
})
onKeyStroke('/', (e) => {
  if (typing(e))
    return
  e.preventDefault()
  searchInput.value?.focus()
})
</script>

<template>
  <div class="page">
    <AFlex justify="space-between" align="flex-start" gap="middle" wrap>
      <div>
        <h1 class="page-title">
          {{ $gettext('Review queue') }}
        </h1>
        <ATypographyText type="secondary">
          {{ $gettext('New listings and changes that need a review, highest risk first. Self service changes take effect directly and are kept in the audit log.') }}
        </ATypographyText>
      </div>
    </AFlex>

    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The queue could not be loaded.')" />
    <AAlert v-if="notice" :type="notice.type" show-icon closable :title="notice.text" @close="notice = null" />

    <div class="cols">
      <ACard :loading="loading" class="col-main" :styles="{ body: { padding: 0 } }">
        <div class="toolbar">
          <ASegmented v-model:value="filter" :options="filters" />
          <span class="flex-1" />
          <ASelect v-model:value="kindFilter" :options="kindOptions" class="w-36" :aria-label="$gettext('Kind of change')" />
          <AInput ref="searchInput" v-model:value="search" class="search" allow-clear :placeholder="$gettext('Plugin ID or author')" :aria-label="$gettext('Search')">
            <template #prefix>
              <span class="i-tabler-search op-50" />
            </template>
          </AInput>
        </div>
        <div v-if="selected.length" class="batch-bar">
          <span class="font-500">{{ $gettext('%{n} selected', { n: String(selected.length) }) }}</span>
          <span class="text-3 op-65">{{ $gettext('All low risk with their checks passed') }}</span>
          <span class="flex-1" />
          <AButton size="small" @click="selected = []">
            {{ $gettext('Clear selection') }}
          </AButton>
          <AButton size="small" type="primary" @click="approveSelected">
            <span class="i-tabler-check" />
            {{ $gettext('Approve all') }}
            <span class="keycap on-primary"><kbd>⇧</kbd><kbd>A</kbd></span>
          </AButton>
        </div>
        <div class="overflow-x-auto">
          <table class="queue">
            <thead>
              <tr>
                <th class="check-col">
                  <ACheckbox
                    :checked="allSelected"
                    :disabled="batchableShown.length === 0"
                    :aria-label="$gettext('Select all low risk changes')"
                    @change="(e: { target: { checked: boolean } }) => toggleAll(e.target.checked)"
                  />
                </th>
                <th>{{ $gettext('Risk') }}</th>
                <th>{{ $gettext('Kind of change') }}</th>
                <th>{{ $gettext('Plugin') }}</th>
                <th>{{ $gettext('Author') }}</th>
                <th>{{ $gettext('Checks') }}</th>
                <th>{{ $gettext('Waiting') }}</th>
                <th>{{ $gettext('Actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, index) in shown"
                :key="item.id"
                :class="{ focus: index === focus, picked: selected.includes(item.id) }"
                @click="focus = index"
                @dblclick="open(item)"
              >
                <td class="check-col">
                  <ACheckbox
                    :disabled="!batchable(item)"
                    :checked="selected.includes(item.id)"
                    :aria-label="$gettext('Select %{name}', { name: localized(item.entry?.name) || item.pluginId || '' })"
                    @click.stop
                    @change="(e: { target: { checked: boolean } }) => toggle(item, e.target.checked)"
                  />
                </td>
                <td class="nowrap">
                  <span class="risk" :class="riskLevel(item)"><i />{{ riskLevel(item) === 'high' ? $gettext('High') : riskLevel(item) === 'medium' ? $gettext('Medium') : $gettext('Low') }}</span>
                </td>
                <td class="nowrap">
                  <ATag :color="kindColor(item.kind)" variant="outlined" class="m-0">
                    {{ kindLabel(item.kind) }}
                  </ATag>
                </td>
                <td>
                  <div class="plugin">
                    <PluginIcon :name="localized(item.entry?.name) || item.pluginId || ''" :size="28" />
                    <div class="min-w-0">
                      <div class="font-600 nowrap">
                        {{ localized(item.entry?.name) || item.pluginId }}
                      </div>
                      <div class="mono text-3 op-65 ellipsis">
                        {{ item.pluginId }}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="nowrap">
                  @{{ item.author }}
                </td>
                <td class="nowrap">
                  <span class="check" :class="checkState(item).tone"><span :class="checkIcon[checkState(item).tone]" />{{ checkState(item).text }}</span>
                </td>
                <td class="nowrap">
                  <span class="op-75">{{ waited(item.updatedAt) }}</span>
                </td>
                <td class="nowrap text-right">
                  <RouterLink :to="`/review/${item.id}`">
                    <AButton size="small" :type="index === focus ? 'primary' : 'default'">
                      {{ $gettext('Review') }}
                    </AButton>
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
          <AEmpty v-if="!loading && shown.length === 0" class="py-8" :description="$gettext('Nothing is waiting here.')" />
        </div>
        <div class="keys">
          <span><kbd>j</kbd><kbd>k</kbd>{{ $gettext('Move') }}</span>
          <span><kbd>x</kbd>{{ $gettext('Select') }}</span>
          <span><kbd>↵</kbd>{{ $gettext('Open') }}</span>
          <span><kbd>a</kbd>{{ $gettext('Approve') }}</span>
          <span><kbd>r</kbd>{{ $gettext('Request changes') }}</span>
          <span><kbd>⇧</kbd><kbd>A</kbd>{{ $gettext('Approve selected') }}</span>
          <span><kbd>/</kbd>{{ $gettext('Search') }}</span>
          <span><kbd>{{ palette.modifier }}</kbd><kbd>K</kbd>{{ $gettext('Command palette') }}</span>
        </div>
      </ACard>

      <AFlex vertical gap="middle" class="col-side">
        <ACard :title="$gettext('Recent self service changes')">
          <template #extra>
            <RouterLink to="/audit" class="text-3">
              {{ $gettext('Audit log') }}
            </RouterLink>
          </template>
          <div v-if="recent.length" class="timeline">
            <RouterLink v-for="change in recent" :key="change.id" :to="`/changes/${change.id}`" class="tl-item">
              <span class="tl-dot" :class="change.kind === 'yank' || change.kind === 'revoke_signer' ? 'warn' : change.state === 'live' ? 'ok' : ''" />
              <div class="min-w-0">
                <div class="tl-text">
                  {{ $gettext('%{name}: %{kind}', { name: recentName(change), kind: kindLabel(change.kind) }) }}
                </div>
                <div class="text-3 op-65">
                  {{ $gettext('@%{login}, %{time}', { login: change.author ?? '', time: fromNow(change.createdAt) }) }}
                </div>
              </div>
            </RouterLink>
          </div>
          <ATypographyText v-else type="secondary" class="text-3">
            {{ $gettext('No self service changes yet.') }}
          </ATypographyText>
        </ACard>
        <ACard :title="$gettext('Approving together')">
          <ATypographyParagraph class="text-3">
            {{ $gettext('Only low risk changes whose checks all passed can be selected and approved together, such as name translations.') }}
          </ATypographyParagraph>
          <ATypographyParagraph type="secondary" class="text-3 mb-0">
            {{ $gettext('New listings, primary key rotations and repository moves are reviewed one by one on their own page.') }}
          </ATypographyParagraph>
        </ACard>
      </AFlex>
    </div>

    <AModal
      :open="!!action"
      :title="actionTitle"
      :confirm-loading="sending"
      :ok-text="action?.kind === 'request' ? $gettext('Send') : $gettext('Approve and merge')"
      @ok="confirmAction"
      @cancel="action = null"
    >
      <template v-if="action">
        <template v-if="action.kind === 'batch'">
          <p>{{ $gettext('Each pull request is approved and merged as you, one after another. A change that cannot be merged stays in the queue.') }}</p>
          <ul class="batch-list">
            <li v-for="item in action.items" :key="item.id">
              <span class="font-500">{{ localized(item.entry?.name) || item.pluginId }}</span>
              <span class="op-65">{{ kindLabel(item.kind) }}</span>
            </li>
          </ul>
        </template>
        <template v-else-if="action.kind === 'approve'">
          <p>{{ $gettext('Approve pull request #%{n} and merge it as you. The change takes effect at the next catalog update.', { n: String(action.item.prNumber ?? '') }) }}</p>
          <ATextarea v-model:value="comment" :rows="3" :maxlength="4000" :placeholder="$gettext('Comment, optional')" />
        </template>
        <template v-else>
          <p>{{ $gettext('The author is notified on GitHub and can resubmit from the change page.') }}</p>
          <ATextarea v-model:value="comment" :rows="5" :maxlength="4000" :placeholder="$gettext('What should the author change?')" />
        </template>
        <AAlert v-if="actionError" type="error" show-icon class="mt-3" :title="actionError" />
      </template>
    </AModal>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--portal-border);
}

.search {
  width: 220px;
  max-width: 100%;
}

.queue {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 13px;
}

.queue th {
  text-align: left;
  font-weight: 500;
  padding: 10px 16px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
  white-space: nowrap;
}

.queue td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: middle;
}

.queue tbody tr {
  cursor: default;
}

.check-col {
  width: 40px;
  padding-right: 0 !important;
}

.queue tbody tr.picked td {
  background: var(--portal-faint);
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background: var(--portal-primary-bg);
  border-bottom: 1px solid var(--portal-border);
  font-size: 13px;
}

.batch-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}

.batch-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  font-size: 13px;
}

.batch-list li + li {
  border-top: 1px solid var(--portal-border);
}

.keycap {
  display: inline-flex;
  gap: 2px;
  margin-left: 4px;
  opacity: 0.7;
}

.keycap.on-primary kbd {
  border-color: rgba(255, 255, 255, 0.5);
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tl-item {
  display: flex;
  gap: 10px;
  color: inherit;
  font-size: 13px;
}

.tl-item:hover .tl-text {
  color: var(--portal-primary);
}

.tl-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--portal-border-strong);
}

.tl-dot.warn {
  background: #faad14;
}

.tl-dot.ok {
  background: #52c41a;
}

.queue tbody tr.focus td {
  background: var(--portal-primary-bg);
}

.queue tbody tr.focus td:first-child {
  box-shadow: inset 3px 0 0 var(--portal-primary);
}

.plugin {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.nowrap {
  white-space: nowrap;
}

.ellipsis {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.risk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.risk i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1677ff;
}

.risk.high i {
  background: #cf1322;
}

.risk.medium i {
  background: #d48806;
}

.risk.low i {
  background: #389e0d;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.check.ok {
  color: #389e0d;
}

.check.fail {
  color: #cf1322;
}

.check.run {
  opacity: 0.7;
}

:global(html.dark) .check.ok {
  color: #6abe39;
}

:global(html.dark) .check.fail {
  color: #e86e6b;
}

.keys {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 10px 16px;
  font-size: 12px;
  opacity: 0.7;
}

.keys span {
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
