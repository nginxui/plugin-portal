<script setup lang="ts">
import type { AuditEntry, AuditKind, AuditQuery } from '@/api/audit'
import { refDebounced, useEventListener } from '@vueuse/core'
import dayjs from 'dayjs'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { auditExportUrl, getAudit } from '@/api/audit'
import { AUDIT_KIND_COLORS, auditDetailLines, auditKindLabel, auditLines, auditNote } from '@/lib/audit'
import { $gettext } from '@/lib/gettext'
import { joinSentences } from '@/lib/labels'

const route = useRoute()

const kind = ref<AuditKind | 'all'>('all')
const actor = ref('')
const subject = ref('')
const days = ref(7)

// The palette links here with a plugin search or an actor; both look back
// over all time.
watch(() => [route.query.q, route.query.actor], ([q, by]) => {
  if (typeof q !== 'string' && typeof by !== 'string')
    return
  subject.value = typeof q === 'string' ? q : ''
  actor.value = typeof by === 'string' ? by : ''
  days.value = 0
}, { immediate: true })
const actorDebounced = refDebounced(actor, 300)
const subjectDebounced = refDebounced(subject, 300)

const query = computed<AuditQuery>(() => ({
  kind: kind.value === 'all' ? undefined : kind.value,
  actor: actorDebounced.value.trim() || undefined,
  subject: subjectDebounced.value.trim() || undefined,
  days: days.value || undefined,
}))

const entries = ref<AuditEntry[]>([])

// The steps the system takes for a change, checks, commit and deploy, follow
// the record of whoever started it, oldest first. A filtered list stays flat.
// Groups start folded; a record opens to show its steps.
const expanded = ref(new Set<number>())
function toggleGroup(id: number) {
  const next = new Set(expanded.value)
  if (!next.delete(id))
    next.add(id)
  expanded.value = next
}

const rows = computed<{ entry: AuditEntry, child: boolean, steps: number }[]>(() => {
  if (kind.value !== 'all')
    return entries.value.map(entry => ({ entry, child: false, steps: 0 }))
  const changesOf = (e: AuditEntry): string[] => [
    ...(typeof e.detail?.change === 'string' ? [e.detail.change] : []),
    ...(Array.isArray(e.detail?.live) ? e.detail.live.filter((c: unknown): c is string => typeof c === 'string') : []),
  ]
  const parentOf = new Map<string, AuditEntry>()
  for (const e of entries.value) {
    if (e.kind !== 'system' && typeof e.detail?.change === 'string' && !parentOf.has(e.detail.change))
      parentOf.set(e.detail.change, e)
  }
  const children = new Map<number, AuditEntry[]>()
  const placed = new Set<number>()
  for (const e of entries.value) {
    if (e.kind !== 'system')
      continue
    const parent = changesOf(e).map(c => parentOf.get(c)).find(p => p && p.at <= e.at)
    if (!parent)
      continue
    children.set(parent.id, [...(children.get(parent.id) ?? []), e])
    placed.add(e.id)
  }
  const out: { entry: AuditEntry, child: boolean, steps: number }[] = []
  for (const e of entries.value) {
    if (placed.has(e.id))
      continue
    const steps = children.get(e.id) ?? []
    out.push({ entry: e, child: false, steps: steps.length })
    if (expanded.value.has(e.id)) {
      for (const c of [...steps].sort((a, b) => a.at - b.at || a.id - b.id))
        out.push({ entry: c, child: true, steps: 0 })
    }
  }
  return out
})
const total = ref(0)
const loading = ref(false)
const failed = ref(false)
// Cursors of the pages before the current one, for going back.
const cursors = ref<(number | undefined)[]>([])
const current = ref<number | undefined>()
const next = ref<number | null>(null)
const selected = ref<AuditEntry | null>(null)

// The details close on a click anywhere but the drawer or another record,
// which shows that record instead.
useEventListener(document, 'pointerdown', (event) => {
  const target = event.target as Element | null
  if (selected.value && target && !target.closest('.record-drawer, .record-row'))
    selected.value = null
})

async function load(before?: number) {
  loading.value = true
  try {
    const page = await getAudit(query.value, before)
    entries.value = page.entries
    total.value = page.total
    next.value = page.next
    current.value = before
    failed.value = false
    if (selected.value && !page.entries.some(e => e.id === selected.value?.id))
      selected.value = null
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

watch(query, () => {
  cursors.value = []
  load()
}, { immediate: true })

function older() {
  if (next.value === null)
    return
  cursors.value.push(current.value)
  load(next.value)
}

function newer() {
  load(cursors.value.pop())
}

const kinds = computed(() => [
  { value: 'all', label: $gettext('All') },
  ...(['review', 'self_service', 'submission', 'maintainer', 'ai', 'settings', 'system', 'account'] as AuditKind[]).map(k => ({ value: k, label: auditKindLabel(k) })),
])

const ranges = computed(() => [
  { value: 7, label: $gettext('Last 7 days') },
  { value: 30, label: $gettext('Last 30 days') },
  { value: 0, label: $gettext('All time') },
])

const totalText = computed(() => {
  const n = String(total.value)
  if (days.value === 7)
    return $gettext('%{n} records in the last 7 days', { n })
  if (days.value === 30)
    return $gettext('%{n} records in the last 30 days', { n })
  return $gettext('%{n} records', { n })
})

function actorName(entry: AuditEntry) {
  return entry.actor ? `@${entry.actor}` : $gettext('Developer portal')
}

const isExternal = (url: string) => url.startsWith('https://')

// A GitHub link as a reader names it: the repository and the commit or pull request.
function recordText(url: string): string {
  const commit = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/commit\/([0-9a-f]+)/.exec(url)
  if (commit)
    return $gettext('%{repo} commit %{sha}', { repo: commit[1], sha: commit[2].slice(0, 7) })
  const pull = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url)
  if (pull)
    return $gettext('%{repo} pull request #%{n}', { repo: pull[1], n: pull[2] })
  return url.replace('https://github.com/', '')
}
const detailText = computed(() => selected.value ? auditDetailLines(selected.value).join('\n') : '')
</script>

<template>
  <div class="page" :class="{ 'beside-drawer': selected }">
    <AFlex justify="space-between" align="flex-start" gap="middle" wrap>
      <div>
        <h1 class="page-title">
          {{ $gettext('Audit log') }}
        </h1>
        <ATypographyText type="secondary">
          {{ $gettext('Every action in the developer portal. Actions that change the catalog link to a commit or pull request that can be checked on GitHub.') }}
        </ATypographyText>
      </div>
      <AFlex gap="small">
        <AButton :href="auditExportUrl(query, 'csv')">
          {{ $gettext('Export CSV') }}
        </AButton>
        <AButton :href="auditExportUrl(query, 'json')">
          {{ $gettext('Export JSON') }}
        </AButton>
      </AFlex>
    </AFlex>

    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The audit log could not be loaded.')" />

    <ACard :styles="{ body: { padding: 0 } }">
      <div class="toolbar">
        <ASegmented v-model:value="kind" :options="kinds" class="scroll-x" />
        <AFlex gap="small" wrap>
          <AInput v-model:value="actor" allow-clear class="w-28" :placeholder="$gettext('Actor')" :aria-label="$gettext('Actor')" />
          <AInput v-model:value="subject" allow-clear class="w-36" :placeholder="$gettext('Plugin ID')" :aria-label="$gettext('Plugin ID')" />
          <ASelect v-model:value="days" :options="ranges" class="w-32" :aria-label="$gettext('Time range')" />
        </AFlex>
      </div>
      <ASpin :spinning="loading">
        <div class="overflow-x-auto">
          <table class="log">
            <thead>
              <tr>
                <th>{{ $gettext('Time') }}</th>
                <th>{{ $gettext('Actor') }}</th>
                <th>{{ $gettext('Kind') }}</th>
                <th>{{ $gettext('Action') }}</th>
                <th>{{ $gettext('Record') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="{ entry, child, steps } in rows"
                :key="entry.id"
                class="record-row"
                :class="{ focus: selected?.id === entry.id, child }"
                tabindex="0"
                @click="selected = entry"
                @keydown.enter="selected = entry"
              >
                <td class="nowrap">
                  <span v-if="child" class="op-65"><span class="branch">└</span>{{ dayjs.unix(entry.at).format('HH:mm:ss') }}</span>
                  <span v-else class="op-85">{{ dayjs.unix(entry.at).format('MM-DD HH:mm:ss') }}</span>
                </td>
                <td class="nowrap">
                  <span class="actor">
                    <AAvatar v-if="entry.actor" :src="entry.actorAvatar ?? undefined" :size="20">{{ entry.actor.slice(0, 1).toUpperCase() }}</AAvatar>
                    <span v-else class="portal-mark"><span class="i-tabler-refresh" /></span>
                    {{ entry.actor ?? actorName(entry) }}
                  </span>
                </td>
                <td class="nowrap">
                  <ATag :color="AUDIT_KIND_COLORS[entry.kind]" class="m-0">
                    {{ auditKindLabel(entry.kind) }}
                  </ATag>
                </td>
                <td>
                  <div v-for="line in auditLines(entry)" :key="line">
                    {{ line }}
                  </div>
                  <div v-if="entry.action === 'catalog.deployed' && entry.detail?.run" class="text-3 op-65">
                    {{ $gettext('deploy run #%{run}', { run: String(entry.detail.run) }) }}
                  </div>
                  <div v-else-if="entry.subject" class="text-3 op-65 mono">
                    {{ entry.subject }}
                  </div>
                  <div v-if="auditNote(entry)" class="text-3 op-65">
                    {{ $gettext('Reason: %{reason}', { reason: auditNote(entry) }) }}
                  </div>
                  <button v-if="steps" type="button" class="steps-toggle" :aria-expanded="expanded.has(entry.id)" @click.stop="toggleGroup(entry.id)">
                    <span :class="expanded.has(entry.id) ? 'i-tabler-chevron-down' : 'i-tabler-chevron-right'" />
                    {{ $ngettext('%{n} step by the system', '%{n} steps by the system', steps, { n: String(steps) }) }}
                  </button>
                </td>
                <td class="nowrap">
                  <template v-if="entry.record">
                    <a v-if="isExternal(entry.record.url)" :href="entry.record.url" target="_blank" rel="noopener" class="mono" @click.stop>{{ entry.record.label }}</a>
                    <RouterLink v-else :to="entry.record.url" class="mono" @click.stop>
                      {{ entry.record.label }}
                    </RouterLink>
                  </template>
                  <span v-else class="op-50">{{ $gettext('Portal') }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <AEmpty v-if="!loading && entries.length === 0" class="py-8" :description="$gettext('No records match these filters.')" />
        </div>
      </ASpin>
      <div class="foot">
        <span class="text-3 op-65">{{ totalText }}</span>
        <AFlex gap="small">
          <AButton size="small" :disabled="cursors.length === 0" @click="newer">
            {{ $gettext('Newer') }}
          </AButton>
          <AButton size="small" :disabled="next === null" @click="older">
            {{ $gettext('Older') }}
          </AButton>
        </AFlex>
      </div>
    </ACard>

    <ATypographyParagraph type="secondary" class="text-3 mt-3 mb-0">
      {{ joinSentences([$gettext('The catalog follows its git history. Should this log be lost, every catalog change can still be traced from its commits and pull requests.'), $gettext('Sign ins, settings and AI use are recorded only here and kept for one year.')]) }}
    </ATypographyParagraph>

    <ADrawer :open="!!selected" :title="$gettext('Record details')" :size="420" :mask="false" :classes="{ root: 'record-drawer' }" :styles="{ wrapper: { top: '64px' } }" @close="selected = null">
      <template v-if="selected">
        <dl class="kv">
          <dt>{{ $gettext('Time') }}</dt>
          <dd>{{ dayjs.unix(selected.at).format('YYYY-MM-DD HH:mm:ss') }}</dd>
          <dt>{{ $gettext('Actor') }}</dt>
          <dd>{{ actorName(selected) }}</dd>
          <template v-if="selected.subject">
            <dt>{{ $gettext('Subject') }}</dt>
            <dd class="mono break-all">
              {{ selected.subject }}
            </dd>
          </template>
          <template v-if="selected.record">
            <dt>{{ $gettext('Record') }}</dt>
            <dd class="break-all">
              <a v-if="isExternal(selected.record.url)" :href="selected.record.url" target="_blank" rel="noopener">{{ recordText(selected.record.url) }}</a>
              <RouterLink v-else :to="selected.record.url">
                {{ $gettext('Change %{id}', { id: selected.record.label }) }}
              </RouterLink>
            </dd>
          </template>
        </dl>
        <pre v-if="detailText" class="codeblock">{{ detailText }}</pre>
      </template>
    </ADrawer>
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

.log {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 13px;
}

.log th {
  text-align: left;
  font-weight: 500;
  padding: 10px 16px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
  white-space: nowrap;
}

.log td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: top;
}

.log tbody tr {
  cursor: default;
}

.log tbody tr:focus-visible {
  outline: 2px solid var(--portal-primary);
  outline-offset: -2px;
}

.log tbody tr.focus td {
  background: var(--portal-primary-bg);
}

.log tbody tr.focus td:first-child {
  box-shadow: inset 3px 0 0 var(--portal-primary);
}

.nowrap {
  white-space: nowrap;
}

.record-row.child td {
  padding-top: 4px;
  padding-bottom: 4px;
  border-top: 0;
  font-size: 12px;
}

.steps-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--portal-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.branch {
  display: inline-block;
  margin-inline: 8px 6px;
  opacity: 0.6;
}

.actor {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.portal-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--portal-faint);
  border: 1px solid var(--portal-border);
  font-size: 12px;
}

.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}

.kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 16px;
  margin: 0;
  font-size: 13px;
}

.kv dt {
  opacity: 0.65;
}

.kv dd {
  margin: 0;
}

.codeblock {
  margin: 16px 0 0;
  padding: 12px;
  border-radius: 6px;
  background: var(--portal-faint);
  border: 1px solid var(--portal-border);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 360px;
  overflow: auto;
}
</style>
