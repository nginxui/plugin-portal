<script setup lang="ts">
import type { Change, ChangeEvent } from '@/api/changes'
import { computed, h, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getChange, retryChange } from '@/api/changes'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { fromNow } from '@/lib/time'

const route = useRoute()
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

const STAGES = ['submitted', 'checks', 'review', 'merged', 'live'] as const

const current = computed(() => {
  const c = change.value
  if (!c)
    return 0
  return c.stage === 'live' ? STAGES.length : STAGES.indexOf(c.stage)
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
  const titles = [$gettext('Submitted'), $gettext('Checks'), $gettext('Maintainer review'), $gettext('Merged'), $gettext('Live in the catalog')]
  return titles.map((title, index) => {
    const status = index < current.value ? 'finish' as const : index === current.value ? stepStatus.value : 'wait' as const
    // The steps component draws a check for an error too, so draw a cross.
    const icon = status === 'error' ? h('span', { class: 'i-tabler-circle-x-filled step-error' }) : undefined
    return { title, status, icon }
  })
})

const title = computed(() => localized(change.value?.entry?.name) || change.value?.pluginId || '')

const status = computed<{ type: 'success' | 'info' | 'warning' | 'error', text: string } | null>(() => {
  const c = change.value
  if (!c)
    return null
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
  if (c.stage === 'merged')
    return { type: 'info', text: $gettext('Approved. The plugin appears in the catalog after the next deploy, usually within minutes.') }
  return null
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
    case 'merged': return $gettext('Merged by a maintainer')
    case 'rejected': return $gettext('Pull request closed')
    case 'live': return $gettext('Listed in the catalog')
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
      <div>
        <h1 class="page-title">
          {{ title }}
        </h1>
        <AFlex gap="small" wrap class="text-3 op-65">
          <span>{{ $gettext('New listing') }}</span>
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
            <template v-if="problems.length || (change.outcome?.outcome === 'rejected' && change.outcome.message)" #description>
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
            <a v-if="change.outcome?.runUrl" :href="change.outcome.runUrl" target="_blank" rel="noopener">
              {{ $gettext('Log of the checks') }}
              <span class="i-tabler-external-link" />
            </a>
            <RouterLink v-if="change.state === 'live' && change.pluginId" :to="`/plugins/${change.pluginId}`">
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

.event {
  padding: 8px 0;
  border-bottom: 1px solid var(--portal-border);
}

.event:last-child {
  border-bottom: 0;
}
</style>
