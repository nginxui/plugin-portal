<script setup lang="ts">
import type { AiReview, ReviewDetail } from '@/api/review'
import { onKeyStroke } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { approveChange, commentOnChange, getAiReview, getQueue, getReview, makeAiReview, rejectChange, requestChanges } from '@/api/review'
import { categoryLabel } from '@/lib/categories'
import { kindLabel } from '@/lib/changeKinds'
import { checkRunLabel } from '@/lib/checkRuns'
import gettext, { $gettext, $ngettext } from '@/lib/gettext'
import { HOST_LOCALES } from '@/lib/hostLocales'
import { joinList, localized, trustLabel } from '@/lib/labels'
import { localeName } from '@/lib/locales'
import { permissionText } from '@/lib/market'
import { previewRows } from '@/lib/preview'
import { formatDate, formatMoment, fromNow } from '@/lib/time'
import { useCrumbs } from '@/stores/crumbs'
import { usePaletteStore } from '@/stores/palette'
import { useReviewStore } from '@/stores/review'

const route = useRoute()
const router = useRouter()
const reviewStore = useReviewStore()
const palette = usePaletteStore()
const data = ref<ReviewDetail | null>(null)
const missing = ref(false)
const id = computed(() => String(route.params.id))
const detail = computed(() => data.value)
// Actions use the internal id; the address shows the short number.
const changeId = computed(() => data.value?.change.id ?? id.value)

async function load() {
  try {
    data.value = await getReview(id.value)
    missing.value = false
    const number = data.value.change.number
    if (number && id.value !== String(number))
      router.replace(`/review/${number}`)
  }
  catch {
    missing.value = true
  }
}
// Moving to the numbered address needs no second load.
watch(id, (value) => {
  if (!data.value || String(data.value.change.number) !== value)
    load()
}, { immediate: true })

const change = computed(() => detail.value?.change ?? null)
const entry = computed(() => (change.value?.entry ?? null) as Record<string, any> | null)
const name = computed(() => localized(entry.value?.name) || change.value?.pluginId || '')
useCrumbs(() => [
  { title: $gettext('Review queue'), to: '/review' },
  ...(change.value ? [{ title: name.value }, { title: change.value.number ? `${kindLabel(change.value.kind)} #${change.value.number}` : kindLabel(change.value.kind) }] : []),
])
const isOpen = computed(() => change.value?.state === 'open' && change.value.stage === 'review' && detail.value?.pull?.state === 'open')

const status = computed(() => {
  const c = change.value
  if (!c)
    return null
  if (c.state === 'merged' || c.state === 'live')
    return { color: 'success', text: $gettext('Merged') }
  if (c.state === 'rejected')
    return { color: 'default', text: $gettext('Closed') }
  if (c.waitingOn === 'author')
    return { color: 'warning', text: $gettext('Waiting for the author') }
  if (c.stage === 'checks')
    return { color: 'processing', text: $gettext('Checking') }
  return { color: 'processing', text: $gettext('Waiting for review') }
})

// Entry fields as a reviewer reads them: the current listing against the change.
const rows = computed(() => {
  const after = entry.value ?? {}
  const before = detail.value?.before ?? null
  const fields: { key: string, label: string, format: (v: any) => string[] }[] = [
    { key: 'name', label: $gettext('Name'), format: v => Object.entries(v ?? {}).map(([l, t]) => l === 'en' ? String(t) : `${localeName(l)}: ${t}`) },
    { key: 'author', label: $gettext('Author'), format: v => v ? [String(v)] : [] },
    { key: 'repository_url', label: $gettext('Repository'), format: v => v ? [String(v).replace('https://github.com/', '')] : [] },
    { key: 'author_public_key', label: $gettext('Primary public key'), format: v => v ? [String(v)] : [] },
    { key: 'categories', label: $gettext('Categories'), format: v => (v ?? []).map(categoryLabel) },
    { key: 'license', label: $gettext('License'), format: v => v ? [String(v)] : [] },
    { key: 'trust', label: $gettext('Trust'), format: v => v ? [trustLabel(String(v)) || String(v)] : [] },
  ]
  return fields
    .filter(f => after[f.key] !== undefined || before?.[f.key] !== undefined)
    .map(f => ({
      label: f.label,
      key: f.key,
      before: before ? f.format(before[f.key]) : [],
      after: f.format(after[f.key]),
      changed: !before || JSON.stringify(before[f.key]) !== JSON.stringify(after[f.key]),
    }))
})

const PREVIEW_LABELS = computed<Record<string, string>>(() => ({
  'Name': $gettext('Name'),
  'Description': $gettext('Description'),
  'Listed release': $gettext('Listed release'),
  'Platforms': $gettext('Platforms'),
  'Categories': $gettext('Categories'),
  'License': $gettext('License'),
  'README': 'README',
  'Icon': $gettext('Icon'),
}))

// The preview of the catalog checks, with field names and languages as the
// interface names them.
const preview = computed(() => previewRows(change.value?.outcome && 'preview' in change.value.outcome ? (change.value.outcome as { preview?: string }).preview : '')
  .map(row => ({
    field: PREVIEW_LABELS.value[row.field] ?? row.field,
    lines: row.field === 'Categories'
      ? row.lines.flatMap(l => l.split(/,\s*/)).map(categoryLabel)
      : row.lines.map((line) => {
          const match = /^([a-z]{2,3}(?:_[A-Z]{2})?) (.+)$/.exec(line)
          return match ? `${localeName(match[1])}: ${match[2]}` : line
        }),
  })))

// Entry fields the preview does not show, for a new listing.
const extraRows = computed(() => rows.value.filter(row => ['author', 'repository_url', 'author_public_key', 'trust'].includes(row.key)))

// A new primary key ends the certificates the old one issued.
const keyRotation = computed(() => !!detail.value?.before && rows.value.some(row => row.key === 'author_public_key' && row.changed))

// The diff rows, with the key ids under a new primary key.
const tableRows = computed(() => rows.value.filter(row => !detail.value?.before || row.changed).flatMap((row) => {
  const rotation = detail.value?.rotation
  if (row.key !== 'author_public_key' || !rotation)
    return [row]
  return [row, { key: 'key_id', label: $gettext('Key ID'), before: rotation.oldId ? [rotation.oldId] : [], after: rotation.newId ? [rotation.newId] : [], changed: true }]
}))

const rotationText = computed(() => {
  const versions = detail.value?.rotation?.versions ?? []
  return versions.length
    ? $gettext('These versions stop installing until the author signs them again with a new certificate: %{list}.', { list: joinList(versions.map(v => `v${v}`)) })
    : $gettext('Versions signed under them stop installing until the author signs them with a certificate of the new key.')
})

const comma = computed(() => gettext.current.startsWith('zh') ? '，' : ', ')

function roleLabel(item: { author: string | null, role: 'maintainer' | null }): string {
  if (item.author && item.author === detail.value?.author?.login)
    return $gettext('Author')
  return item.role === 'maintainer' ? $gettext('Maintainer') : ''
}

const historyText = computed(() => {
  const a = detail.value?.author
  if (!a || a.changes === 0)
    return $gettext('None')
  return a.merged === a.changes
    ? $ngettext('%{n} in total, all merged', '%{n} in total, all merged', a.changes, { n: String(a.changes) })
    : $gettext('%{n} in total, %{merged} merged', { n: String(a.changes), merged: String(a.merged) })
})

// The permissions of the listed release, as users read them.
const permissions = computed(() => {
  const manifest = detail.value?.listing?.manifest as { permissions?: string[], permission_reasons?: Record<string, string>, network_hosts?: string[] } | null | undefined
  return (manifest?.permissions ?? []).map(p => ({
    id: p,
    ...permissionText(gettext.current, p),
    reason: manifest?.permission_reasons?.[p] ?? '',
    hosts: p === 'network' ? manifest?.network_hosts ?? [] : [],
  }))
})

const claimText = computed(() => {
  const claim = detail.value?.claim ?? ''
  const installed = /installed the NGINX UI Plugin Catalog app on (\S+)$/.exec(claim)
  if (installed)
    return $gettext('Installed the Nginx UI Plugin Catalog app on %{repo}', { repo: installed[1] })
  const admin = /has admin permission on (\S+)$/.exec(claim)
  if (admin)
    return $gettext('Has admin permission on %{repo}', { repo: admin[1] })
  return claim || $gettext('No claim recorded')
})

// What users see now and after the change.
interface Doc { name?: Record<string, string>, description?: Record<string, string>, homepage_url?: string, screenshots?: { id: string, path: string, dark_path?: string, caption?: Record<string, string> }[] }
const compareMode = ref<'side' | 'slider' | 'changes'>('side')
const compareTheme = ref<'light' | 'dark'>('light')
const compareLocale = ref('en')
const localeOptions = HOST_LOCALES.map(code => ({ value: code, label: localeName(code) }))
const beforeDoc = computed<Doc | null>(() => {
  const b = detail.value?.before as Record<string, any> | null
  const l = detail.value?.listing
  if (!b && !l)
    return null
  return {
    name: b?.name,
    description: b?.description ?? l?.description ?? undefined,
    homepage_url: b?.homepage_url,
    screenshots: (l?.screenshots ?? []).map((sh, i) => ({ id: `s${i + 1}`, path: sh.url, ...(sh.dark_url ? { dark_path: sh.dark_url } : {}), ...(sh.caption ? { caption: sh.caption } : {}) })),
  }
})
const afterDoc = computed<Doc>(() => {
  const e = entry.value ?? {}
  const base = beforeDoc.value ?? {}
  return {
    ...base,
    ...(e.name ? { name: e.name } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.homepage_url ? { homepage_url: e.homepage_url } : {}),
  }
})
// Whether anything on the listing page changes, which the comparison is for.
const userVisible = computed(() => {
  const b = beforeDoc.value
  if (!b)
    return true
  const a = afterDoc.value
  return (['name', 'description', 'homepage_url', 'screenshots'] as const).some(k => JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null))
})
const compareImages = computed(() => Object.fromEntries((beforeDoc.value?.screenshots ?? []).flatMap(sh => [[sh.path, sh.path], ...(sh.dark_path ? [[sh.dark_path, sh.dark_path]] : [])])))

// Names by language, each approved or kept as listed.
const nameRows = computed(() => {
  const before = (detail.value?.before as { name?: Record<string, string> } | null)?.name ?? {}
  const after = (entry.value?.name ?? {}) as Record<string, string>
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].map(locale => ({
    locale,
    before: before[locale] ?? '',
    after: after[locale] ?? '',
    state: !before[locale] ? 'add' : !after[locale] ? 'removed' : before[locale] === after[locale] ? 'same' : 'mod',
  })).sort((a, b) => Number(a.state === 'same') - Number(b.state === 'same'))
})
const changedNames = computed(() => nameRows.value.filter(r => r.state !== 'same'))
const approveLabel = computed(() => changedNames.value.length ? $gettext('Approve the checked names') : $gettext('Approve and merge'))
const unchecked = ref<string[]>([])
watch(() => change.value?.id, () => (unchecked.value = []))
function toggleName(locale: string, on: boolean) {
  unchecked.value = on ? unchecked.value.filter(l => l !== locale) : [...unchecked.value, locale]
}

const checksPassed = computed(() => (detail.value?.checks ?? []).every(c => c.status !== 'completed' || ['success', 'neutral', 'skipped'].includes(c.conclusion ?? '')))

// Acting on the pull request.
const approving = ref(false)
const approveOpen = ref(false)
const requestOpen = ref(false)
const requestText = ref('')

// The AI pre-review: findings to look at, never a decision.
const ai = ref<{ enabled: boolean, review: AiReview | null } | null>(null)
const aiPicked = ref<number[]>([])
const aiBusy = ref(false)
const aiError = ref('')
watch([id, () => gettext.current], async () => {
  ai.value = null
  aiPicked.value = []
  aiError.value = ''
  ai.value = await getAiReview(changeId.value, gettext.current).catch(() => null)
  pickWarnings()
}, { immediate: true })
function pickWarnings() {
  aiPicked.value = (ai.value?.review?.findings ?? []).map((f, i) => f.severity === 'warn' ? i : -1).filter(i => i >= 0)
}
async function runAi() {
  aiBusy.value = true
  aiError.value = ''
  try {
    const result = await makeAiReview(changeId.value, gettext.current)
    ai.value = { enabled: true, review: result.review }
    pickWarnings()
  }
  catch (e) {
    aiError.value = e instanceof ApiError && e.code === 'quota' ? $gettext('No AI requests are left for today.') : $gettext('The summary could not be made. Please try again later.')
  }
  finally {
    aiBusy.value = false
  }
}
function toggleFinding(index: number, on: boolean) {
  aiPicked.value = on ? [...aiPicked.value, index] : aiPicked.value.filter(i => i !== index)
}
// The picked findings become the text of a request for changes.
function findingsToRequest() {
  const findings = ai.value?.review?.findings ?? []
  requestText.value = aiPicked.value.sort((a, b) => a - b).map(i => `- ${findings[i].text}${findings[i].sources.length ? ` (${findings[i].sources.map(s => s.label).join(', ')})` : ''}`).join('\n')
  requestOpen.value = true
}
const SEVERITY_ICON: Record<string, string> = {
  warn: 'i-tabler-alert-triangle c-warn',
  info: 'i-tabler-info-circle c-info',
  ok: 'i-tabler-circle-check c-ok',
}
const requesting = ref(false)
const comment = ref('')
const commenting = ref(false)
const actionError = ref('')

async function approve() {
  approving.value = true
  actionError.value = ''
  try {
    await approveChange(changeId.value, '', unchecked.value)
    approveOpen.value = false
    await Promise.all([load(), reviewStore.refresh()])
  }
  catch (e) {
    actionError.value = e instanceof ApiError && e.code === 'merge_refused'
      ? $gettext('GitHub refused the merge. The pull request may have conflicts or failing checks.')
      : $gettext('The change could not be approved. Please try again.')
    approveOpen.value = false
  }
  finally {
    approving.value = false
  }
}

async function sendRequest() {
  if (!requestText.value.trim())
    return
  requesting.value = true
  actionError.value = ''
  try {
    await requestChanges(changeId.value, requestText.value)
    requestOpen.value = false
    requestText.value = ''
    await Promise.all([load(), reviewStore.refresh()])
  }
  catch {
    actionError.value = $gettext('The request could not be sent. Please try again.')
  }
  finally {
    requesting.value = false
  }
}

const rejectOpen = ref(false)
const rejectText = ref('')
const rejecting = ref(false)

async function sendReject() {
  if (!rejectText.value.trim())
    return
  rejecting.value = true
  actionError.value = ''
  try {
    await rejectChange(changeId.value, rejectText.value)
    rejectOpen.value = false
    rejectText.value = ''
    await Promise.all([load(), reviewStore.refresh()])
  }
  catch {
    actionError.value = $gettext('The change could not be rejected. Please try again.')
  }
  finally {
    rejecting.value = false
  }
}

async function sendComment() {
  if (!comment.value.trim())
    return
  commenting.value = true
  try {
    await commentOnChange(changeId.value, comment.value)
    comment.value = ''
    await load()
  }
  finally {
    commenting.value = false
  }
}

function checkIcon(c: { status: string, conclusion: string | null }) {
  if (c.status !== 'completed')
    return 'i-tabler-loader-2 op-60'
  return ['success', 'neutral', 'skipped'].includes(c.conclusion ?? '') ? 'i-tabler-circle-check-filled ok' : 'i-tabler-circle-x-filled bad'
}

function reviewState(state: string | null) {
  switch (state) {
    case 'APPROVED': return $gettext('approved')
    case 'CHANGES_REQUESTED': return $gettext('requested changes')
    default: return ''
  }
}

// Keys: a approve, r request changes, v next comparison, j and k the next
// and previous change of the queue.
const queueIds = ref<string[]>([])
onMounted(async () => {
  queueIds.value = (await getQueue().catch(() => ({ changes: [] }))).changes.filter(c => c.waitingOn === 'maintainer').map(c => c.id)
})
function typing(e: KeyboardEvent) {
  return e.metaKey || e.ctrlKey || e.altKey || approveOpen.value || requestOpen.value || rejectOpen.value
    || (e.target instanceof HTMLElement && (/^(?:INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable))
}
onKeyStroke('a', (e) => {
  if (!typing(e) && isOpen.value) {
    e.preventDefault()
    approveOpen.value = true
  }
})
onKeyStroke('r', (e) => {
  if (!typing(e) && isOpen.value) {
    e.preventDefault()
    requestOpen.value = true
  }
})
onKeyStroke('v', (e) => {
  if (typing(e))
    return
  const order = ['side', 'slider', 'changes'] as const
  compareMode.value = order[(order.indexOf(compareMode.value) + 1) % order.length]
})
function step(by: number) {
  const at = queueIds.value.indexOf(changeId.value)
  const next = queueIds.value[at + by]
  if (next)
    router.push(`/review/${next}`)
}
onKeyStroke('j', e => !typing(e) && step(1))
onKeyStroke('k', e => !typing(e) && step(-1))
</script>

<template>
  <div class="page">
    <AResult v-if="missing" status="404" :title="$gettext('Change not found')" />
    <template v-else-if="detail && change">
      <ACard>
        <div class="head">
          <PluginIcon :name="name" :size="56" />
          <div class="flex-1 min-w-0">
            <AFlex gap="small" align="center" wrap>
              <h1 class="page-title m-0">
                {{ kindLabel(change.kind) }}
              </h1>
              <ATag v-if="change.risk === 'high'" color="warning" class="m-0">
                {{ $gettext('High risk change') }}
              </ATag>
              <ATag v-if="status" :color="status.color" class="m-0">
                {{ status.text }}
              </ATag>
            </AFlex>
            <div class="text-3 op-65 mt-1">
              {{ name }} <span class="mono">{{ change.pluginId }}</span>{{ comma }}{{ detail.author
                ? $gettext('submitted by @%{login} at %{time}', { login: detail.author.login, time: formatMoment(change.createdAt) })
                : $gettext('found in a new release %{time}', { time: fromNow(change.createdAt) }) }}
            </div>
          </div>
          <AFlex v-if="isOpen" gap="small" wrap>
            <AButton @click="requestOpen = true">
              {{ $gettext('Request changes') }}
              <kbd class="keycap">r</kbd>
            </AButton>
            <AButton danger @click="rejectOpen = true">
              {{ $gettext('Reject') }}
            </AButton>
            <AButton type="primary" @click="approveOpen = true">
              <span class="i-tabler-check" />
              {{ approveLabel }}
              <kbd class="keycap on-primary">a</kbd>
            </AButton>
          </AFlex>
        </div>
        <AAlert v-if="actionError" type="error" show-icon class="mt-4" :title="actionError" />
      </ACard>

      <div class="cols">
        <AFlex vertical gap="middle" class="col-main">
          <ACard v-if="ai?.enabled || ai?.review">
            <template #title>
              <span class="i-tabler-message-2 mr-2 op-65" />{{ $gettext('AI pre-review summary') }}
            </template>
            <template #extra>
              <AFlex align="center" gap="small">
                <span v-if="ai.review" class="text-3 op-65">{{ $gettext('%{model}, %{time}', { model: ai.review.model, time: fromNow(ai.review.createdAt) }) }}</span>
                <span class="ai-badge">AI</span>
              </AFlex>
            </template>
            <template v-if="ai.review">
              <AEmpty v-if="!ai.review.findings.length" :image-style="{ height: '40px' }" :description="$gettext('Nothing to point out.')" />
              <div v-for="(f, i) in ai.review.findings" :key="i" class="finding">
                <span :class="SEVERITY_ICON[f.severity]" class="finding-icon" />
                <div class="min-w-0 flex-1">
                  <div>{{ f.text }}</div>
                  <AFlex v-if="f.sources.length" gap="6" wrap class="mt-2">
                    <component :is="s.url ? 'a' : 'span'" v-for="(s, j) in f.sources" :key="j" class="source" :href="s.url" target="_blank" rel="noopener">
                      <span class="i-tabler-file-text" />{{ s.label }}
                    </component>
                  </AFlex>
                </div>
                <ACheckbox :checked="aiPicked.includes(i)" :aria-label="$gettext('Pick this finding')" @change="(e: { target: { checked: boolean } }) => toggleFinding(i, e.target.checked)" />
              </div>
              <AFlex justify="space-between" align="center" gap="middle" wrap class="mt-4">
                <span class="text-3 op-65">{{ $gettext('The summary is for reference only. It approves and rejects nothing; the checks decide.') }}</span>
                <AFlex gap="small">
                  <AButton size="small" :loading="aiBusy" @click="runAi">
                    {{ $gettext('Summarize again') }}
                  </AButton>
                  <AButton v-if="isOpen" :disabled="!aiPicked.length" @click="findingsToRequest">
                    {{ $gettext('Turn the %{n} picked into a request for changes', { n: String(aiPicked.length) }) }}
                  </AButton>
                </AFlex>
              </AFlex>
            </template>
            <AFlex v-else justify="space-between" align="center" gap="middle" wrap>
              <span class="text-3 op-65">{{ $gettext('Reads the README, the manifest, the store texts and the code that names each network host, and points out what deserves a look.') }}</span>
              <AButton type="primary" :loading="aiBusy" @click="runAi">
                <span class="i-tabler-sparkles" />{{ $gettext('Summarize') }}
              </AButton>
            </AFlex>
            <AAlert v-if="aiError" type="error" show-icon class="mt-3" :title="aiError" />
          </ACard>

          <ACard v-if="userVisible">
            <template #title>
              <span class="i-tabler-eye mr-2 op-65" />{{ $gettext('What users will see') }}
            </template>
            <template #extra>
              <AFlex gap="small" wrap>
                <ASegmented v-model:value="compareMode" size="small" :options="[{ value: 'side', label: $gettext('Side by side') }, { value: 'slider', label: $gettext('Slider') }, { value: 'changes', label: $gettext('Changes only') }]" />
                <ASegmented v-model:value="compareTheme" size="small" :options="[{ value: 'light', label: $gettext('Light') }, { value: 'dark', label: $gettext('Dark') }]" />
                <ASelect v-model:value="compareLocale" size="small" class="w-32" :options="localeOptions" :aria-label="$gettext('Preview language')" />
              </AFlex>
            </template>
            <ReviewCompare
              v-model:mode="compareMode"
              :before="beforeDoc"
              :after="afterDoc"
              :manifest="detail.listing?.manifest ?? null"
              :version="detail.listing?.version ?? null"
              :author="(entry?.author as string | undefined) ?? null"
              :trust="(entry?.trust as string | undefined) ?? null"
              :categories="(entry?.categories as string[] | undefined) ?? []"
              :icon-url="detail.listing?.iconUrl ?? null"
              :locale="compareLocale"
              :theme="compareTheme"
              :images="compareImages"
            />
          </ACard>

          <ACard v-if="changedNames.length" :title="$gettext('Names by language')" :styles="{ body: { padding: 0 } }">
            <template #extra>
              <span class="text-3 op-65">{{ $gettext('Uncheck a name to keep it as listed') }}</span>
            </template>
            <div class="overflow-x-auto">
              <table class="diff">
                <thead>
                  <tr>
                    <th>{{ $gettext('Language') }}</th>
                    <th>{{ $gettext('Now') }}</th>
                    <th>{{ $gettext('After the change') }}</th>
                    <th>{{ $gettext('Kind of change') }}</th>
                    <th>{{ $gettext('Approve') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in nameRows" :key="row.locale">
                    <td>{{ localeName(row.locale) }}</td>
                    <td :class="{ old: row.state === 'mod' || row.state === 'removed' }">
                      {{ row.before || $gettext('Not set') }}
                    </td>
                    <td :class="{ new: row.state === 'mod' || row.state === 'add' }">
                      {{ row.after || $gettext('Not set') }}
                    </td>
                    <td>
                      <ATag v-if="row.state !== 'same'" :color="row.state === 'add' ? 'success' : row.state === 'removed' ? 'error' : 'blue'" class="m-0">
                        {{ row.state === 'add' ? $gettext('New') : row.state === 'removed' ? $gettext('Removed') : $gettext('Changed') }}
                      </ATag>
                      <span v-else class="text-3 op-50">{{ $gettext('Unchanged') }}</span>
                    </td>
                    <td>
                      <ACheckbox v-if="row.state !== 'same'" :checked="!unchecked.includes(row.locale)" :disabled="!isOpen || (row.locale === 'en' && row.state === 'add')" :aria-label="$gettext('Approve the name in %{lang}', { lang: localeName(row.locale) })" @change="(e: { target: { checked: boolean } }) => toggleName(row.locale, e.target.checked)" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="HOST_LOCALES.length - nameRows.length > 0" class="text-3 op-65 px-4 py-3">
              {{ $gettext('The other %{n} languages have no name and show the English one.', { n: String(HOST_LOCALES.length - nameRows.length) }) }}
            </div>
          </ACard>

          <ACard v-if="!detail.before" :title="$gettext('Listing')">
            <template #extra>
              <span class="text-3 op-65">{{ $gettext('Not listed yet') }}</span>
            </template>
            <dl class="kv">
              <template v-for="row in preview" :key="row.field">
                <dt>{{ row.field }}</dt>
                <dd>
                  <div v-for="(line, i) in row.lines" :key="i">
                    {{ line }}
                  </div>
                </dd>
              </template>
              <template v-for="row in extraRows" :key="row.key">
                <dt>{{ row.label }}</dt>
                <dd :class="{ mono: row.key === 'author_public_key' }">
                  <div v-for="(line, i) in row.after" :key="i">
                    {{ line }}
                  </div>
                </dd>
              </template>
            </dl>
          </ACard>

          <ACard v-if="detail.before" :title="$gettext('What changes')">
            <template #extra>
              <span class="text-3 op-65">{{ detail.before ? $gettext('Compared with the current listing') : $gettext('Not listed yet') }}</span>
            </template>
            <div class="overflow-x-auto">
              <table class="diff">
                <thead>
                  <tr>
                    <th>{{ $gettext('Field') }}</th>
                    <th v-if="detail.before">
                      {{ $gettext('Current') }}
                    </th>
                    <th>{{ detail.before ? $gettext('After the change') : $gettext('Listed as') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in tableRows" :key="row.key">
                    <td class="field">
                      {{ row.label }}
                    </td>
                    <td v-if="detail.before" :class="{ old: row.changed }">
                      <div v-for="(line, i) in row.before" :key="i" :class="{ mono: row.key === 'author_public_key' }">
                        {{ line }}
                      </div>
                    </td>
                    <td :class="{ new: row.changed && detail.before }">
                      <div v-for="(line, i) in row.after" :key="i" :class="{ mono: row.key === 'author_public_key' }">
                        {{ line }}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <AAlert v-if="keyRotation" type="warning" show-icon class="m-4">
              <template #title>
                <div class="font-500">
                  {{ $gettext('Once approved, signer certificates issued by the old primary key are no longer accepted.') }}
                </div>
                <div class="text-3">
                  {{ rotationText }}
                </div>
              </template>
            </AAlert>
          </ACard>

          <ACard v-if="permissions.length">
            <template #title>
              <span class="i-tabler-shield-check mr-2 op-65" />{{ $gettext('Permissions, as users see them') }}
            </template>
            <template #extra>
              <span class="text-3 op-65">{{ $gettext('This change does not touch the permissions') }}</span>
            </template>
            <ul class="perm-list">
              <li v-for="p in permissions" :key="p.id">
                <span class="i-tabler-shield-check c-info" />
                <div class="min-w-0">
                  <div>{{ p.description }}</div>
                  <div class="mono text-3 op-65">
                    {{ p.id }}{{ p.hosts.length ? `: ${p.hosts.join(', ')}` : '' }}
                  </div>
                  <div v-if="p.reason" class="text-3 op-65">
                    {{ $gettext('Note from the author: %{note}', { note: p.reason }) }}
                  </div>
                </div>
              </li>
            </ul>
          </ACard>

          <ACard v-if="detail.before && preview.length" :title="$gettext('Listing preview')">
            <dl class="kv">
              <template v-for="row in preview" :key="row.field">
                <dt>{{ row.field }}</dt>
                <dd>
                  <div v-for="(line, i) in row.lines" :key="i">
                    {{ line }}
                  </div>
                </dd>
              </template>
            </dl>
          </ACard>

          <ACard v-if="detail.author" :title="$gettext('Identity')">
            <ul class="checklist">
              <li>
                <span class="i-tabler-circle-check-filled ok" />
                <div>
                  <div>@{{ detail.author?.login }} {{ claimText }}</div>
                  <div class="text-3 op-65">
                    {{ $gettext('Read from GitHub when the change was submitted') }}
                  </div>
                </div>
              </li>
              <li v-if="detail.rotation?.seenIn">
                <span :class="detail.rotation.seenIn.length ? 'i-tabler-circle-check-filled ok' : 'i-tabler-alert-triangle-filled warn'" />
                <div>
                  <div>{{ detail.rotation.seenIn.length ? $gettext('The new primary key is already used by %{list}', { list: joinList(detail.rotation.seenIn) }) : $gettext('The new primary key has not appeared in the catalog before') }}</div>
                  <div v-if="!detail.rotation.seenIn.length" class="text-3 op-65">
                    {{ $gettext('A primary key used for the first time. Confirm the reason for the rotation with the author.') }}
                  </div>
                </div>
              </li>
              <li v-if="detail.repository">
                <span class="i-tabler-brand-github op-60" />
                <a :href="detail.repository" target="_blank" rel="noopener">{{ detail.repository.replace('https://github.com/', '') }}</a>
              </li>
            </ul>
          </ACard>

          <ACard :title="$gettext('Discussion')">
            <template #extra>
              <span class="text-3 op-65">{{ $gettext('Public on GitHub') }}</span>
            </template>
            <AEmpty v-if="detail.conversation.length === 0" :description="$gettext('No comments yet.')" class="my-2" />
            <div v-for="(item, i) in detail.conversation" :key="i" class="comment">
              <AAvatar :size="32">
                {{ (item.author ?? '?').slice(0, 1).toUpperCase() }}
              </AAvatar>
              <div class="bubble">
                <div class="bubble-head">
                  <span class="font-600">{{ item.author }}</span>
                  <span v-if="roleLabel(item)" class="text-3 op-65">{{ roleLabel(item) }}</span>
                  <span v-if="reviewState(item.state)" class="op-75">{{ reviewState(item.state) }}</span>
                  <span class="text-3 op-60">{{ formatMoment(item.at) }}</span>
                </div>
                <div v-if="item.body" class="bubble-body">
                  {{ item.body }}
                </div>
              </div>
            </div>
            <template v-if="isOpen">
              <ATextarea v-model:value="comment" :rows="3" :placeholder="$gettext('Leave a comment. Markdown is supported.')" class="mt-2" />
              <AFlex justify="flex-end" class="mt-3">
                <AButton :loading="commenting" :disabled="!comment.trim()" @click="sendComment">
                  {{ $gettext('Comment') }}
                </AButton>
              </AFlex>
            </template>
          </ACard>
        </AFlex>

        <AFlex vertical gap="middle" class="col-side">
          <ACard :title="$gettext('Check results')">
            <template #extra>
              <ATag :color="checksPassed ? 'success' : 'error'" class="m-0">
                {{ checksPassed ? $gettext('All passed') : $gettext('Needs attention') }}
              </ATag>
            </template>
            <ul class="checklist">
              <li v-for="c in detail.checks" :key="c.name">
                <span :class="checkIcon(c)" />
                <ATooltip :title="c.name">
                  <a :href="c.url" target="_blank" rel="noopener">{{ checkRunLabel(c.name) }}</a>
                </ATooltip>
              </li>
              <li v-if="detail.checks.length === 0" class="op-65">
                {{ $gettext('No checks reported on the pull request.') }}
              </li>
            </ul>
            <a v-if="change.outcome?.runUrl" :href="change.outcome.runUrl" target="_blank" rel="noopener" class="inline-block mt-3 text-3">
              {{ $gettext('Log of the submission checks') }}
              <span class="i-tabler-external-link" />
            </a>
          </ACard>

          <ACard :title="$gettext('Shortcuts')">
            <dl class="shortcuts">
              <dt>{{ approveLabel }}</dt>
              <dd><kbd class="keycap">a</kbd></dd>
              <dt>{{ $gettext('Request changes') }}</dt>
              <dd><kbd class="keycap">r</kbd></dd>
              <dt>{{ $gettext('Switch the comparison') }}</dt>
              <dd><kbd class="keycap">v</kbd></dd>
              <dt>{{ $gettext('Next and previous') }}</dt>
              <dd><kbd class="keycap">j</kbd><kbd class="keycap">k</kbd></dd>
              <dt>{{ $gettext('Command palette') }}</dt>
              <dd><kbd class="keycap">{{ palette.modifier }}</kbd><kbd class="keycap">K</kbd></dd>
            </dl>
          </ACard>

          <ACard v-if="detail.author" :title="$gettext('Author')">
            <AFlex align="center" gap="middle">
              <AAvatar :src="detail.author.avatarUrl ?? undefined" :size="40">
                {{ detail.author.login.slice(0, 1).toUpperCase() }}
              </AAvatar>
              <div>
                <div class="font-600">
                  {{ detail.author.login }}
                </div>
                <a :href="`https://github.com/${detail.author.login}`" target="_blank" rel="noopener" class="text-3">github.com/{{ detail.author.login }}</a>
              </div>
            </AFlex>
            <dl class="kv small mt-4">
              <template v-if="detail.author.plugins?.length">
                <dt>{{ $gettext('Listed plugins') }}</dt>
                <dd>{{ joinList(detail.author.plugins.map(p => p.name)) }}</dd>
              </template>
              <template v-if="detail.author.firstListed">
                <dt>{{ $gettext('First listed') }}</dt>
                <dd>{{ formatDate(detail.author.firstListed) }}</dd>
              </template>
              <dt>{{ $gettext('Earlier changes') }}</dt>
              <dd>{{ historyText }}</dd>
              <dt>{{ $gettext('Submitted') }}</dt>
              <dd>{{ formatDate(change.createdAt) }}</dd>
              <template v-if="detail.repositoryCreatedAt">
                <dt>{{ $gettext('Repository created') }}</dt>
                <dd>{{ formatDate(detail.repositoryCreatedAt) }}</dd>
              </template>
            </dl>
          </ACard>

          <ACard>
            <AFlex vertical gap="small">
              <a v-if="detail.pull" :href="detail.pull.url" target="_blank" rel="noopener">
                <span class="i-tabler-git-pull-request mr-1" />{{ $gettext('Pull request #%{n} on GitHub', { n: String(detail.pull.number) }) }}
              </a>
              <a href="#" @click.prevent="router.push('/review')">
                <span class="i-tabler-inbox mr-1" />{{ $gettext('Back to the review queue') }}
              </a>
            </AFlex>
          </ACard>
        </AFlex>
      </div>

      <AModal v-model:open="approveOpen" :title="$gettext('Approve and merge')" :confirm-loading="approving" :ok-text="$gettext('Approve and merge')" @ok="approve">
        <p>{{ $gettext('Approve pull request #%{n} and merge it as you. The plugin is listed at the next deploy.', { n: String(detail.pull?.number ?? '') }) }}</p>
        <AAlert v-if="!checksPassed" type="warning" show-icon :title="$gettext('Some checks of the pull request have not passed.')" />
        <AAlert v-if="unchecked.length" type="info" show-icon class="mt-3" :title="$gettext('The names in %{list} stay as listed: they are taken out of the pull request before it is merged.', { list: unchecked.map(localeName).join(', ') })" />
      </AModal>

      <AModal v-model:open="requestOpen" :title="$gettext('Request changes')" :confirm-loading="requesting" :ok-text="$gettext('Send')" :ok-button-props="{ disabled: !requestText.trim() }" @ok="sendRequest">
        <p class="op-75">
          {{ $gettext('The author sees this on GitHub and in the Developer Center, and can resubmit from their change page.') }}
        </p>
        <ATextarea v-model:value="requestText" :rows="5" :placeholder="$gettext('What should the author change?')" />
      </AModal>

      <AModal
        v-model:open="rejectOpen"
        :title="$gettext('Reject the change')"
        :confirm-loading="rejecting"
        :ok-text="$gettext('Reject')"
        :ok-button-props="{ danger: true, disabled: !rejectText.trim() }"
        @ok="sendReject"
      >
        <p>{{ $gettext('Pull request #%{n} is closed with your reason as its last comment. The author cannot resubmit this change and starts a new submission instead.', { n: String(detail.pull?.number ?? '') }) }}</p>
        <ATextarea v-model:value="rejectText" :rows="5" :maxlength="4000" :placeholder="$gettext('Why is the change rejected?')" />
      </AModal>
    </template>
    <ASkeleton v-else active />
  </div>
</template>

<style scoped>
.finding {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 0;
}

.finding + .finding {
  border-top: 1px solid var(--portal-border);
}

.finding-icon {
  flex: none;
  margin-top: 3px;
}

.source {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--portal-faint);
  border: 1px solid var(--portal-border);
  font-size: 12px;
  color: inherit;
}

a.source:hover {
  color: var(--portal-primary);
}

.ai-badge {
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  color: #722ed1;
  background: #f9f0ff;
  border: 1px solid #d3adf7;
}

:global(html.dark) .ai-badge {
  color: #b37feb;
  background: #1a1325;
  border-color: #391085;
}

.c-warn {
  color: #d48806;
}

.c-ok {
  color: #389e0d;
}

.keycap {
  display: inline-block;
  min-width: 16px;
  margin-inline-start: 4px;
  padding: 0 4px;
  border: 1px solid var(--portal-border-strong);
  border-radius: 4px;
  font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: center;
}

.keycap.on-primary {
  border-color: rgba(255, 255, 255, 0.5);
}

.shortcuts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px 12px;
  margin: 0;
  font-size: 13px;
}

.shortcuts dd {
  margin: 0;
  text-align: end;
}

.perm-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.perm-list li {
  display: flex;
  gap: 10px;
  padding: 10px 0;
}

.perm-list li + li {
  border-top: 1px solid var(--portal-border);
}

.c-info {
  color: var(--portal-primary);
  margin-top: 3px;
}

.head {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.diff {
  width: 100%;
  min-width: 480px;
  border-collapse: collapse;
  font-size: 13px;
}

.diff th,
.diff td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: top;
}

.diff th {
  font-weight: 500;
  background: var(--portal-faint);
}

.diff tbody tr:last-child td {
  border-bottom: 0;
}

.diff .field {
  width: 120px;
  font-weight: 500;
  white-space: nowrap;
}

.diff .mono {
  word-break: break-all;
}

.diff td.old {
  color: #ff4d4f;
  text-decoration: line-through;
}

.diff td.new {
  color: #52c41a;
}

.kv {
  display: grid;
  grid-template-columns: minmax(96px, max-content) 1fr;
  gap: 10px 24px;
  margin: 0;
  font-size: 13px;
}

.kv dt {
  opacity: 0.65;
}

.kv dd.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.kv dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.checklist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}

.checklist li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.checklist li > span:first-child {
  flex: none;
  font-size: 18px;
}

.ok {
  color: #52c41a;
}

.bad {
  color: #ff4d4f;
}

.warn {
  color: #faad14;
}

.comment {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}

.bubble {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
}

.bubble-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 8px 12px;
  border-bottom: 1px solid var(--portal-border);
  background: var(--portal-faint);
  font-size: 13px;
}

.bubble-body {
  padding: 10px 12px;
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
