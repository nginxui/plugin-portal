<script setup lang="ts">
import type { Change, ChangeEvent } from '@/api/changes'
import { computed, h, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getChange, retryChange } from '@/api/changes'
import { categoryLabel } from '@/lib/categories'
import { kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { fromNow } from '@/lib/time'

const route = useRoute()
const router = useRouter()
const data = ref<{ change: Change, canRetry: boolean, events: ChangeEvent[] } | null>(null)
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

// A self service change skips the review.
const selfService = computed(() => change.value?.class === 'self_service')
const stages = computed(() => selfService.value
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
  const titles = selfService.value
    ? [$gettext('Submitted'), $gettext('Checks'), $gettext('Committed to the catalog'), $gettext('Live in the catalog')]
    : [$gettext('Submitted'), $gettext('Checks'), $gettext('Maintainer review'), $gettext('Merged'), $gettext('Live in the catalog')]
  return titles.map((title, index) => {
    const status = index < current.value ? 'finish' as const : index === current.value ? stepStatus.value : 'wait' as const
    // The steps component draws a check for an error too, so draw a cross.
    const icon = status === 'error' ? h('span', { class: 'i-tabler-circle-x-filled step-error' }) : undefined
    return { title, status, icon }
  })
})

const title = computed(() => localized(change.value?.entry?.name) || change.value?.pluginId || '')

const crumbs = computed(() => {
  const link = (text: string, to: string) => ({
    title: text,
    href: to,
    onClick: (e: MouseEvent) => {
      e.preventDefault()
      router.push(to)
    },
  })
  const items = [link($gettext('My plugins'), '/plugins')]
  if (change.value?.pluginId)
    items.push(link(title.value, `/plugins/${change.value.pluginId}`))
  return [...items, { title: change.value ? kindLabel(change.value.kind) : '' }]
})

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
    case 'review': return $gettext('Checks passed, pull request #%{n} opened', { n: String(e.detail?.prNumber ?? '') })
    case 'merged': return selfService.value ? $gettext('Committed to the catalog') : $gettext('Merged by a maintainer')
    case 'rejected': return e.detail?.comment ? $gettext('Rejected by a maintainer') : $gettext('Pull request closed')
    case 'live': return selfService.value ? $gettext('Live in the catalog') : $gettext('Listed in the catalog')
    default: return e.stage
  }
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
      <ABreadcrumb :items="crumbs" />
      <div>
        <h1 class="page-title">
          {{ kindLabel(change.kind) }}
        </h1>
        <AFlex gap="small" wrap class="text-3 op-65">
          <span>{{ title }}</span>
          <span class="mono">{{ change.pluginId }}</span>
          <span>{{ $gettext('Submitted %{time}', { time: fromNow(change.createdAt) }) }}</span>
        </AFlex>
      </div>

      <ACard>
        <ASteps :current="current" :items="steps" responsive />
      </ACard>

      <div class="cols">
        <AFlex vertical gap="middle" class="col-main">
          <AAlert v-if="status" :type="status.type" show-icon :title="status.text">
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
            <template v-if="data.canRetry" #action>
              <AButton size="small" :loading="retrying" @click="retry">
                {{ $gettext('Run the checks again') }}
              </AButton>
            </template>
          </AAlert>
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
          <ACard :title="$gettext('History')">
            <AFlex vertical gap="small">
              <AFlex v-for="(e, index) in data.events" :key="index" justify="space-between" gap="middle" class="event">
                <span>{{ eventText(e) }}<span v-if="e.actor" class="op-65"> (@{{ e.actor }})</span></span>
                <span class="op-65 text-3 whitespace-nowrap">{{ fromNow(e.at) }}</span>
              </AFlex>
            </AFlex>
          </ACard>
        </AFlex>
        <ACard :title="$gettext('Links')" class="col-side">
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
      </div>
    </template>
    <ASkeleton v-else active />
  </div>
</template>

<style scoped>
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

.event {
  padding: 8px 0;
  border-bottom: 1px solid var(--portal-border);
}

.event:last-child {
  border-bottom: 0;
}
</style>
