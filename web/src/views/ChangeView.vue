<script setup lang="ts">
import type { Change, ChangeEvent } from '@/api/changes'
import { computed, h, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getChange, retryChange, withdrawChange } from '@/api/changes'
import { getPrefs, savePrefs } from '@/api/notifications'
import { categoryLabel } from '@/lib/categories'
import { kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { itemLabel } from '@/lib/storeDiff'
import { formatTime, fromNow, waited } from '@/lib/time'
import { useCrumbs } from '@/stores/crumbs'
import { usePluginStore } from '@/stores/plugin'

const route = useRoute()
const data = ref<{ change: Change, canRetry: boolean, canWithdraw: boolean, others: Change[], events: ChangeEvent[] } | null>(null)
const missing = ref(false)
const retrying = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

const id = computed(() => String(route.params.id))
const change = computed(() => data.value?.change ?? null)

async function load() {
  clearTimeout(timer)
  try {
    data.value = await getChange(id.value)
    missing.value = false
  }
  catch {
    missing.value = true
    return
  }
  // Checks and the deploy take minutes; follow them while the page is open.
  if (change.value?.waitingOn === 'system')
    timer = setTimeout(load, 15000)
}

watch(id, load, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))

// The plugin the change belongs to, for the plugin head; a new listing the
// user cannot open yet has none.
const pluginStore = usePluginStore()
watch(() => change.value?.pluginId, (pluginId) => {
  if (pluginId)
    pluginStore.open(pluginId)
}, { immediate: true })
const headPlugin = computed(() => {
  const plugin = pluginStore.detail?.plugin
  return plugin && plugin.id === change.value?.pluginId ? plugin : null
})

// A self service change skips the review; a store change that went to the
// author's repository waits for the author's merge instead.
const selfService = computed(() => change.value?.class === 'self_service')
const repoStore = computed(() => change.value?.delivery === 'bot' || change.value?.delivery === 'patch')
const stages = computed(() => repoStore.value
  ? ['submitted', 'checks', 'review', 'merged', 'live']
  : selfService.value
    ? ['submitted', 'checks', 'merged', 'live']
    : ['submitted', 'checks', 'review', 'merged', 'live'])

const current = computed(() => {
  const c = change.value
  if (!c)
    return 0
  return c.stage === 'live' ? stages.value.length : stages.value.indexOf(c.stage)
})

const stepStatus = computed<'process' | 'error' | 'finish'>(() => {
  const c = change.value
  if (!c)
    return 'process'
  if (c.state === 'rejected' || (c.stage === 'checks' && c.waitingOn === 'author'))
    return 'error'
  return c.stage === 'live' ? 'finish' : 'process'
})

const steps = computed(() => {
  const titles = repoStore.value
    ? [$gettext('Submitted'), $gettext('Automatic checks'), $gettext('Merge the pull request'), $gettext('Catalog updated'), $gettext('Visible to users')]
    : selfService.value
      ? [$gettext('Submitted'), $gettext('Checks'), $gettext('Committed to the catalog'), $gettext('Live in the catalog')]
      : [$gettext('Submitted'), $gettext('Checks'), $gettext('Maintainer review'), $gettext('Merged'), $gettext('Live in the catalog')]
  return titles.map((title, index) => {
    const status = index < current.value ? 'finish' as const : index === current.value ? stepStatus.value : 'wait' as const
    // The steps component draws a check for an error too, so draw a cross.
    const icon = status === 'error' ? h('span', { class: 'i-tabler-circle-x-filled step-error' }) : undefined
    // When each stage was reached and by whom, from the history.
    const stage = stages.value[index]
    const reached = [...(data.value?.events ?? [])].reverse().find(e => e.stage === stage)
    const lines: string[] = []
    if (reached)
      lines.push(formatTime(reached.at))
    if (reached?.actor)
      lines.push(`@${reached.actor}`)
    if (index === current.value && change.value?.state === 'open') {
      if (!reached && change.value.updatedAt)
        lines.push($gettext('Waited %{time}', { time: waited(change.value.updatedAt) }))
      if (change.value.waitingOn === 'author')
        lines.push($gettext('Waiting for you'))
    }
    else if (index < current.value && !reached && stage === 'checks') {
      lines.push($gettext('Passed'))
    }
    else if (index > current.value) {
      if (stage === 'merged' && repoStore.value)
        lines.push($gettext('Within minutes of the merge'))
      else if (stage === 'live')
        lines.push($gettext('Once Nginx UI refreshes its marketplace'))
    }
    const description = lines.length ? h('div', { class: 'step-lines' }, lines.map(line => h('div', line))) : undefined
    return { title, status, icon, description }
  })
})

const title = computed(() => localized(headPlugin.value?.name) || localized(change.value?.entry?.name) || change.value?.pluginId || '')

useCrumbs(() => [
  { title: $gettext('My plugins'), to: '/plugins' },
  ...(change.value?.pluginId ? [{ title: title.value, to: `/plugins/${change.value.pluginId}` }] : []),
  { title: $gettext('Change progress') },
])

// Where each item of a store change stands.
function itemState(item: { review: boolean }): string {
  const c = change.value
  if (!c)
    return ''
  if (c.state === 'withdrawn' || c.state === 'rejected')
    return $gettext('Stopped')
  if (c.stage === 'live')
    return item.review ? $gettext('Waiting for name review') : $gettext('Live')
  if (c.stage === 'merged')
    return item.review ? $gettext('Waiting for name review') : $gettext('Takes effect at the next catalog update')
  return $gettext('Waiting for the merge')
}

// The title of the main card: the kind of change and how many items it holds.
const cardTitle = computed(() => {
  const c = change.value
  if (!c)
    return ''
  return c.items?.length ? $gettext('%{kind}, %{n} items', { kind: kindLabel(c.kind), n: String(c.items.length) }) : kindLabel(c.kind)
})
const submittedBy = computed(() => {
  const first = data.value?.events.find(e => e.stage === 'submitted')
  return first ? $gettext('Submitted by @%{login} %{time}', { login: first.actor ?? '', time: formatTime(first.at) }) : ''
})

// Dot colors of the history.
function eventTone(e: ChangeEvent): string {
  if (e.stage === 'rejected' || (e.stage === 'checks' && e.detail?.outcome))
    return 'bad'
  if (e.stage === 'reminder' || e.stage === 'changes_requested' || e.stage === 'withdrawn')
    return 'muted'
  if (e.stage === 'merged' || e.stage === 'live')
    return 'ok'
  return 'info'
}

// What a self service change asked for, one row per operation.
const requested = computed(() => {
  const ops = change.value?.operations
  if (!ops)
    return []
  const rows: { key: string, icon: string, tone: string, title: string, values: string[], mono: boolean }[] = []
  if (ops.yank?.length)
    rows.push({ key: 'yank', icon: 'i-tabler-arrow-back-up', tone: 'warn', title: $gettext('Yank a version'), values: ops.yank.map(v => `v${v}`), mono: true })
  if (ops.unyank?.length)
    rows.push({ key: 'unyank', icon: 'i-tabler-arrow-forward-up', tone: 'ok', title: $gettext('Restore a version'), values: ops.unyank.map(v => `v${v}`), mono: true })
  if (ops.revoke_signers?.length)
    rows.push({ key: 'revoke', icon: 'i-tabler-key-off', tone: 'bad', title: $gettext('Revoke a signer'), values: ops.revoke_signers, mono: true })
  if (ops.categories)
    rows.push({ key: 'categories', icon: 'i-tabler-tags', tone: 'info', title: $gettext('Change categories'), values: ops.categories.map(categoryLabel), mono: false })
  if (ops.names)
    rows.push({ key: 'names', icon: 'i-tabler-language', tone: 'info', title: $gettext('Names from a new release'), values: Object.entries(ops.names).map(([locale, name]) => `${locale}: ${name}`), mono: false })
  return rows
})

const status = computed<{ type: 'success' | 'info' | 'warning' | 'error', text: string } | null>(() => {
  const c = change.value
  if (!c)
    return null
  if (c.state === 'live' && selfService.value)
    return { type: 'success', text: $gettext('The change is live in the catalog.') }
  if (c.state === 'live')
    return { type: 'success', text: $gettext('The plugin is listed in the catalog.') }
  if (c.state === 'rejected')
    return { type: 'error', text: $gettext('The pull request was closed without merging.') }
  if (c.stage === 'checks' && c.waitingOn === 'author')
    return { type: 'warning', text: $gettext('The checks found problems. Fix them in a new release, then run the checks again.') }
  if (c.stage === 'checks' && c.outcome?.outcome === 'dispatch_failed')
    return { type: 'error', text: $gettext('The checks could not be started. Please try again later.') }
  if (c.stage === 'checks' && c.outcome && c.waitingOn === 'system')
    return { type: 'error', text: $gettext('The checks could not finish. A maintainer will look into it.') }
  if (c.stage === 'checks')
    return { type: 'info', text: $gettext('The packages, signatures and listing are being checked. This takes a few minutes.') }
  if (c.stage === 'review')
    return { type: 'info', text: $gettext('Waiting for a maintainer to review the submission.') }
  if (c.stage === 'merged' && selfService.value)
    return { type: 'info', text: $gettext('The change is in the catalog sources and takes effect at its next update, usually within minutes.') }
  if (c.stage === 'merged')
    return { type: 'info', text: $gettext('Approved. The plugin appears in the catalog after the next deploy, usually within minutes.') }
  return null
})

// A maintainer who rejects leaves a reason; a pull request closed on GitHub has none.
const rejectReason = computed(() => {
  const found = [...(data.value?.events ?? [])].reverse().find(e => e.stage === 'rejected')
  return typeof found?.detail?.comment === 'string' ? found.detail.comment : ''
})

const problems = computed(() => (change.value?.outcome?.problems ?? '').split('\n').map(line => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean))

function eventText(e: ChangeEvent): string {
  switch (e.stage) {
    case 'submitted': return e.detail?.retry ? $gettext('Checks started again') : $gettext('Submitted')
    case 'checks':
      if (e.detail?.outcome === 'dispatch_failed')
        return $gettext('The checks could not be started')
      return e.detail?.outcome === 'rejected' || e.detail?.outcome === 'checks_failed' ? $gettext('Checks found problems') : $gettext('Checks could not finish')
    case 'review': return repoStore.value
      ? $gettext('Pull request #%{n} opened on %{repo}', { n: String(e.detail?.prNumber ?? ''), repo: change.value?.repo ?? '' })
      : $gettext('Checks passed, pull request #%{n} opened', { n: String(e.detail?.prNumber ?? '') })
    case 'merged': return selfService.value ? $gettext('Committed to the catalog') : $gettext('Merged by a maintainer')
    case 'rejected': return e.detail?.comment ? $gettext('Rejected by a maintainer') : $gettext('Pull request closed')
    case 'changes_requested': return $gettext('A maintainer asked for changes')
    case 'reminder': return $gettext('Waited %{h} hours for you, a reminder was sent', { h: String(e.detail?.hours ?? 18) })
    case 'withdrawn': return $gettext('Withdrawn')
    case 'batch': return $gettext('More translations added to the pull request')
    case 'live': return selfService.value ? $gettext('Live in the catalog') : $gettext('Listed in the catalog')
    default: return e.stage
  }
}

// Withdrawing.
const withdrawing = ref(false)
const withdrawOpen = ref(false)
async function withdraw() {
  withdrawing.value = true
  try {
    await withdrawChange(id.value)
    withdrawOpen.value = false
    await load()
  }
  finally {
    withdrawing.value = false
  }
}

// Notification preferences.
const prefs = ref<{ inApp: boolean, emailOnAction: boolean, emailOnLive: boolean, email: string | null, mail: boolean } | null>(null)
getPrefs().then(p => (prefs.value = p)).catch(() => {})
async function setPref(key: 'inApp' | 'emailOnAction' | 'emailOnLive', value: boolean) {
  if (!prefs.value)
    return
  prefs.value = { ...prefs.value, [key]: value }
  await savePrefs(prefs.value)
}
async function setEmail(value: string) {
  if (!prefs.value)
    return
  prefs.value = { ...prefs.value, email: value || null }
  await savePrefs(prefs.value).catch(() => {})
}

// A small track of another change.
function miniTrack(c: Change) {
  const order = ['submitted', 'checks', 'review', 'merged', 'live']
  const at = order.indexOf(c.stage)
  return order.map((_, i) => (i < at ? 'done' : i === at ? (c.waitingOn === 'author' ? 'warn' : 'cur') : ''))
}
function otherText(c: Change) {
  if (c.waitingOn === 'author')
    return $gettext('Waiting for you')
  if (c.stage === 'review')
    return $gettext('Waiting for a maintainer')
  if (c.stage === 'merged')
    return $gettext('Takes effect at the next catalog update')
  return $gettext('Being checked')
}

async function retry() {
  retrying.value = true
  try {
    await retryChange(id.value)
    await load()
  }
  finally {
    retrying.value = false
  }
}
</script>

<template>
  <div class="page">
    <AResult v-if="missing" status="404" :title="$gettext('Change not found')" />
    <template v-else-if="change && data">
      <PluginHeader v-if="headPlugin" :plugin="headPlugin" />
      <div v-else>
        <h1 class="page-title">
          {{ kindLabel(change.kind) }}
        </h1>
        <AFlex gap="small" wrap class="text-3 op-65">
          <span v-if="title !== change.pluginId">{{ title }}</span>
          <span class="mono">{{ change.pluginId }}</span>
          <span>{{ $gettext('Submitted %{time}', { time: fromNow(change.createdAt) }) }}</span>
        </AFlex>
      </div>

      <div class="cols">
        <AFlex vertical gap="middle" class="col-main">
          <ACard :title="cardTitle">
            <template #extra>
              <span class="text-3 op-65">{{ submittedBy }}</span>
            </template>
            <ASteps :current="current" :items="steps" label-placement="vertical" responsive class="change-steps" />
            <div v-if="repoStore && change.state === 'open' && change.stage === 'review'" class="callout mt-5">
              <span class="i-tabler-clock text-6 c-warn" />
              <div class="min-w-0 flex-1">
                <div class="font-600">
                  {{ change.delivery === 'bot' ? $gettext('Waiting for you to merge pull request #%{n} on GitHub', { n: String(change.prNumber ?? '') }) : $gettext('Waiting for you to commit the files to %{repo}', { repo: change.repo ?? '' }) }}
                </div>
                <div class="text-3 op-65 mt-1">
                  {{ change.delivery === 'bot' ? $gettext('The pull request is on %{repo}. Once it is merged, the change shows in the catalog within minutes.', { repo: change.repo ?? '' }) : $gettext('Unpack the patch at the root of the repository and commit it to the default branch. The portal notices the commit by itself.') }}
                </div>
              </div>
              <AFlex gap="small" wrap>
                <AButton v-if="data.canWithdraw" @click="withdrawOpen = true">
                  {{ $gettext('Withdraw the change') }}
                </AButton>
                <AButton v-if="change.delivery === 'bot' && change.prUrl" type="primary" :href="change.prUrl" target="_blank">
                  <span class="i-tabler-brand-github" />{{ $gettext('Merge on GitHub') }}
                </AButton>
                <AButton v-if="change.patchUrl" type="primary" :href="change.patchUrl">
                  <span class="i-tabler-download" />{{ $gettext('Download the patch') }}
                </AButton>
              </AFlex>
            </div>
            <AAlert v-if="status && !(repoStore && change.state === 'open' && change.stage === 'review')" :type="status.type" show-icon :title="status.text" class="mt-5">
              <template v-if="problems.length || rejectReason || (change.outcome?.outcome === 'rejected' && change.outcome.message)" #description>
                <div v-if="rejectReason" class="mb-2 whitespace-pre-wrap">
                  {{ $gettext('Reason: %{reason}', { reason: rejectReason }) }}
                </div>
                <div v-if="change.outcome?.outcome === 'rejected' && change.outcome.message" class="mb-2">
                  {{ change.outcome.message }}
                </div>
                <ul v-if="problems.length" class="m-0 pl-5">
                  <li v-for="(line, index) in problems" :key="index">
                    {{ line }}
                  </li>
                </ul>
              </template>
              <template v-if="data.canRetry || data.canWithdraw" #action>
                <AFlex gap="small" wrap>
                  <AButton v-if="data.canRetry" size="small" :loading="retrying" @click="retry">
                    {{ $gettext('Run the checks again') }}
                  </AButton>
                  <AButton v-if="data.canWithdraw" size="small" @click="withdrawOpen = true">
                    {{ $gettext('Withdraw') }}
                  </AButton>
                </AFlex>
              </template>
            </AAlert>
          </ACard>
          <ACard v-if="requested.length" :title="$gettext('What was asked')">
            <div v-for="row in requested" :key="row.key" class="op">
              <span class="op-icon" :class="row.tone"><span :class="row.icon" /></span>
              <div class="min-w-0">
                <div class="font-500">
                  {{ row.title }}
                </div>
                <AFlex gap="6" wrap class="mt-2">
                  <span v-for="value in row.values" :key="value" class="op-value" :class="{ mono: row.mono }">{{ value }}</span>
                </AFlex>
              </div>
            </div>
            <div v-if="change.reason" class="reason">
              <div class="reason-label">
                {{ $gettext('Reason') }}
              </div>
              <div class="reason-text">
                {{ change.reason }}
              </div>
            </div>
          </ACard>
          <ACard v-if="change.items?.length" :title="$gettext('Each item')" :styles="{ body: { padding: 0 } }">
            <table class="items">
              <thead>
                <tr>
                  <th>{{ $gettext('Item') }}</th>
                  <th>{{ $gettext('Review') }}</th>
                  <th>{{ $gettext('Progress') }}</th>
                  <th>{{ $gettext('Current state') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in change.items" :key="item.label">
                  <td>
                    {{ itemLabel(item, (change.entry ?? {}) as never) }}
                    <span v-if="item.value" class="text-3 op-65 ml-1">{{ item.value }}</span>
                  </td>
                  <td>
                    <ATag v-if="item.review" color="blue" class="m-0">
                      {{ $gettext('Name review after the merge') }}
                    </ATag>
                    <span v-else class="text-3 op-65">{{ $gettext('No review') }}</span>
                  </td>
                  <td>
                    <span class="mini-track"><span v-for="(st, i) in miniTrack(change)" :key="i" :class="st" /></span>
                  </td>
                  <td>{{ itemState(item) }}</td>
                </tr>
              </tbody>
            </table>
          </ACard>
          <ACard>
            <template #title>
              <span class="i-tabler-history mr-2 align-[-2px]" />{{ $gettext('History') }}
            </template>
            <div class="timeline">
              <div v-for="(e, index) in [...data.events].reverse()" :key="index" class="tl-item">
                <span class="tl-dot" :class="eventTone(e)" />
                <div class="min-w-0">
                  <div>{{ eventText(e) }}<span v-if="e.actor" class="op-65"> (@{{ e.actor }})</span></div>
                  <div class="text-3 op-65 mt-1">
                    {{ formatTime(e.at) }}
                  </div>
                </div>
              </div>
            </div>
          </ACard>
        </AFlex>
        <AFlex vertical gap="middle" class="col-side">
          <ACard :title="$gettext('Links')">
            <AFlex vertical gap="small">
              <a v-if="change.prUrl" :href="change.prUrl" target="_blank" rel="noopener">
                {{ $gettext('Pull request #%{n}', { n: String(change.prNumber) }) }}
                <span class="i-tabler-external-link" />
              </a>
              <a v-if="change.commitUrl" :href="change.commitUrl" target="_blank" rel="noopener">
                {{ $gettext('Commit in the catalog') }}
                <span class="i-tabler-external-link" />
              </a>
              <a v-if="change.outcome?.runUrl" :href="change.outcome.runUrl" target="_blank" rel="noopener">
                {{ $gettext('Log of the checks') }}
                <span class="i-tabler-external-link" />
              </a>
              <RouterLink v-if="change.pluginId && (selfService || change.state === 'live')" :to="`/plugins/${change.pluginId}${change.kind === 'categories' || !selfService ? '' : '/versions'}`">
                {{ $gettext('Manage the plugin') }}
              </RouterLink>
            </AFlex>
            <ATypographyParagraph v-if="change.prUrl" type="secondary" class="mt-4 mb-0 text-3">
              {{ $gettext('The review is public on GitHub. You are mentioned in the pull request, so GitHub notifies you of comments.') }}
            </ATypographyParagraph>
          </ACard>
          <ACard v-if="data.others.length" :title="$gettext('Your other changes in progress')">
            <RouterLink v-for="o in data.others" :key="o.id" :to="`/changes/${o.id}`" class="other">
              <PluginIcon :src="null" :name="localized(o.entry?.name) || o.pluginId || ''" :size="36" />
              <div class="min-w-0 flex-1">
                <div class="font-500">
                  {{ localized(o.entry?.name) || o.pluginId }}, {{ kindLabel(o.kind) }}
                </div>
                <AFlex align="center" gap="small" class="text-3 op-65 mt-1">
                  <span class="mini-track"><span v-for="(st, i) in miniTrack(o)" :key="i" :class="st" /></span>
                  <span :class="{ 'c-warn-text': o.waitingOn === 'author' }">{{ otherText(o) }}</span>
                </AFlex>
              </div>
            </RouterLink>
          </ACard>
          <ACard v-if="prefs" :title="$gettext('Notifications')">
            <AFlex vertical gap="12" class="text-3">
              <AFlex justify="space-between" align="center" gap="small">
                <span>{{ $gettext('Tell me in the portal when a change moves') }}</span>
                <ASwitch :checked="prefs.inApp" size="small" @change="(v: boolean) => setPref('inApp', v)" />
              </AFlex>
              <AFlex justify="space-between" align="center" gap="small">
                <span>{{ $gettext('Email me when I need to act') }}</span>
                <ASwitch :checked="prefs.emailOnAction" size="small" :disabled="!prefs.mail" @change="(v: boolean) => setPref('emailOnAction', v)" />
              </AFlex>
              <AFlex justify="space-between" align="center" gap="small">
                <span>{{ $gettext('Email me when a listing goes live') }}</span>
                <ASwitch :checked="prefs.emailOnLive" size="small" :disabled="!prefs.mail" @change="(v: boolean) => setPref('emailOnLive', v)" />
              </AFlex>
              <AInput v-if="prefs.mail && (prefs.emailOnAction || prefs.emailOnLive)" :value="prefs.email ?? ''" size="small" :placeholder="$gettext('Email address')" @change="(e: Event) => setEmail((e.target as HTMLInputElement).value)" />
              <span v-if="!prefs.mail" class="op-65">{{ $gettext('Email is not available yet.') }}</span>
            </AFlex>
          </ACard>
          <ACard>
            <div class="font-600 text-3">
              {{ $gettext('Every plugin page shows the progress at the top') }}
            </div>
            <div class="text-3 op-65 mt-2">
              {{ $gettext('A change in progress shows as one line at the top of its plugin page. Click it to open this page.') }}
            </div>
          </ACard>
        </AFlex>
      </div>
      <AModal v-model:open="withdrawOpen" :title="$gettext('Withdraw the change')" :confirm-loading="withdrawing" :ok-text="$gettext('Withdraw')" :ok-button-props="{ danger: true }" @ok="withdraw">
        <p>{{ change.prNumber ? $gettext('Pull request #%{n} is closed and the change stops here. You can submit again at any time.', { n: String(change.prNumber) }) : $gettext('The change stops here. You can submit again at any time.') }}</p>
      </AModal>
    </template>
    <ASkeleton v-else active />
  </div>
</template>

<style scoped>
.callout {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border: 1px solid #ffe58f;
  border-radius: 8px;
  background: #fffbe6;
}

:global(html.dark) .callout {
  border-color: #594214;
  background: #2b2111;
}

.c-warn {
  color: #faad14;
}

.items {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.items th {
  text-align: start;
  font-weight: 500;
  padding: 10px 16px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
}

.items td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--portal-border);
}

.mini-track {
  display: inline-flex;
  gap: 3px;
}

.mini-track span {
  width: 12px;
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

.other {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  color: inherit;
}

.c-warn-text {
  color: #d48806;
}

.change-steps :deep(.step-lines) {
  font-size: 12px;
  line-height: 18px;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tl-item {
  display: flex;
  gap: 12px;
}

.tl-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  border: 2px solid var(--portal-primary);
}

.tl-dot.ok {
  border-color: #52c41a;
}

.tl-dot.bad {
  border-color: #ff4d4f;
}

.tl-dot.muted {
  border-color: var(--portal-border-strong);
}

.other + .other {
  border-top: 1px solid var(--portal-border);
}

:deep(.step-error) {
  font-size: 32px;
  color: #ff4d4f;
}

.op {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.op + .op {
  margin-top: 16px;
}

.op-icon {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.op-icon.warn {
  color: #d46b08;
  background: #fff7e6;
}

.op-icon.ok {
  color: #389e0d;
  background: #f6ffed;
}

.op-icon.bad {
  color: #cf1322;
  background: #fff1f0;
}

.op-icon.info {
  color: var(--portal-primary-text);
  background: var(--portal-primary-bg);
}

:global(html.dark) .op-icon.warn {
  color: #e89a3c;
  background: #2b1d11;
}

:global(html.dark) .op-icon.ok {
  color: #6abe39;
  background: #162312;
}

:global(html.dark) .op-icon.bad {
  color: #e86e6b;
  background: #2c1618;
}

.op-value {
  padding: 1px 8px;
  border-radius: 6px;
  border: 1px solid var(--portal-border-strong);
  background: var(--portal-faint);
  font-size: 13px;
}

.op-value.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.reason {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--portal-border);
}

.reason-label {
  font-size: 12px;
  opacity: 0.65;
  margin-bottom: 6px;
}

.reason-text {
  padding: 8px 12px;
  border-left: 3px solid var(--portal-border-strong);
  background: var(--portal-faint);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
