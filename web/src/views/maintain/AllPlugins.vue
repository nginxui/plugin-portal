<script setup lang="ts">
import type { AdminPlugin, AdminPlugins } from '@/api/maintain'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { addBlock, delist, getAllPlugins, setTrust } from '@/api/maintain'
import { $gettext } from '@/lib/gettext'
import { joinClauses, joinSentences, localized, storeSourceShort, trustLabel } from '@/lib/labels'
import { fromNow } from '@/lib/time'

// Every plugin of the catalog and what a maintainer may do to it (spec
// 11.5). Changing trust, delisting and blocking each open a pull request.

const router = useRouter()
const route = useRoute()
const data = ref<AdminPlugins | null>(null)
const failed = ref(false)
async function load() {
  try {
    data.value = await getAllPlugins()
  }
  catch {
    failed.value = true
  }
}
const blockOpen = ref(false)
// When the block list last grew.
const lastBlocked = computed(() => (data.value?.blocked ?? []).map(b => b.added_at ?? '').filter(Boolean).sort().at(-1) ?? null)

const state = ref<'all' | 'listed' | 'review' | 'delisted'>('all')
const trust = ref<string>('all')
const source = ref<'all' | 'github' | 'vendor'>('all')
const search = ref('')
const PAGE = 20
const page = ref(1)
// A filter starts again from the first page.
watch([state, trust, source, search], () => (page.value = 1))

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (data.value?.plugins ?? []).filter(p =>
    (state.value === 'all' || (state.value === 'listed' ? p.state === 'listed' || p.state === 'yanked' : p.state === state.value))
    && (trust.value === 'all' || p.trust === trust.value)
    && (source.value === 'all' || p.ownerKind === source.value)
    && (!q || p.id.includes(q) || localized(p.name).toLowerCase().includes(q) || (p.owner ?? '').toLowerCase().includes(q)))
})
const paged = computed(() => shown.value.slice((page.value - 1) * PAGE, page.value * PAGE))

function stateTag(p: AdminPlugin) {
  switch (p.state) {
    case 'listed': return { color: 'success', text: $gettext('Listed') }
    case 'review': return { color: 'processing', text: $gettext('In review') }
    case 'yanked': return { color: 'warning', text: $gettext('Newest version yanked') }
    default: return { color: 'error', text: $gettext('Delisted') }
  }
}

// Actions.
type Action = { kind: 'trust' | 'delist' | 'block', plugin: AdminPlugin } | { kind: 'block-new' }
const action = ref<Action | null>(null)
const form = ref({ trust: 'community', reason: '', block: false, repository: '', pluginId: '' })
const sending = ref(false)
const error = ref('')

function start(next: Action) {
  action.value = next
  error.value = ''
  form.value = {
    trust: 'plugin' in next ? next.plugin.trust ?? 'community' : 'community',
    reason: '',
    block: next.kind === 'block',
    repository: 'plugin' in next ? next.plugin.repo ?? '' : '',
    pluginId: '',
  }
}

onMounted(async () => {
  await load()
  // The command palette opens the block list form with a plugin id.
  if (typeof route.query.block === 'string') {
    start({ kind: 'block-new' })
    form.value.pluginId = route.query.block
  }
})

function onMenu(p: AdminPlugin, key: string) {
  if (key === 'audit')
    router.push({ path: '/audit', query: { q: p.id } })
  else if (key === 'catalog')
    window.open(`https://plugins.nginxui.com/plugins/${p.id}/`, '_blank', 'noopener')
  else
    start({ kind: key as 'trust' | 'delist' | 'block', plugin: p })
}

async function confirm() {
  const a = action.value
  if (!a)
    return
  if (!form.value.reason.trim()) {
    error.value = $gettext('Give a reason. It goes to the audit log and to the admins of the plugin.')
    return
  }
  sending.value = true
  error.value = ''
  try {
    let change: string
    if (a.kind === 'trust')
      change = (await setTrust(a.plugin.id, form.value.trust, form.value.reason)).change
    else if (a.kind === 'delist' || a.kind === 'block')
      change = (await delist(a.plugin.id, form.value.reason, form.value.block, form.value.block && form.value.repository ? form.value.repository : null)).change
    else
      change = (await addBlock({ ...(form.value.pluginId ? { plugin_id: form.value.pluginId.trim() } : {}), ...(form.value.repository ? { repository: form.value.repository.trim() } : {}), reason: form.value.reason })).change
    action.value = null
    router.push(`/changes/${change}`)
  }
  catch {
    error.value = $gettext('The action could not be sent. Please try again.')
  }
  finally {
    sending.value = false
  }
}

const title = computed(() => {
  const a = action.value
  if (!a)
    return ''
  if (a.kind === 'trust')
    return $gettext('Change the trust of %{name}', { name: localized(a.plugin.name) })
  if (a.kind === 'delist')
    return $gettext('Delist %{name}', { name: localized(a.plugin.name) })
  if (a.kind === 'block')
    return $gettext('Delist and block %{name}', { name: localized(a.plugin.name) })
  return $gettext('Add to the block list')
})
</script>

<template>
  <div class="page">
    <AFlex justify="space-between" align="flex-start" gap="middle" wrap>
      <div>
        <h1 class="page-title">
          {{ $gettext('All plugins') }}
        </h1>
        <ATypographyText type="secondary">
          {{ $gettext('Every plugin of the catalog and what maintainers may do to it. Delisting and blocking are written to the catalog repository as pull requests.') }}
        </ATypographyText>
      </div>
    </AFlex>

    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The plugins could not be loaded.')" />
    <ASkeleton v-if="!data && !failed" active />

    <template v-if="data">
      <div class="stats">
        <div class="stat">
          <span class="text-3 op-65">{{ $gettext('Listed') }}</span>
          <span class="num">{{ data.counts.listed }}</span>
          <span class="text-3 op-65">{{ $gettext('Official %{a}, partner %{b}, community %{c}', { a: String(data.counts.byTrust.official ?? 0), b: String(data.counts.byTrust.verified ?? 0), c: String(data.counts.byTrust.community ?? 0) }) }}</span>
        </div>
        <div class="stat">
          <span class="text-3 op-65">{{ $gettext('New this week') }}</span>
          <span class="num">{{ data.counts.newThisWeek }}</span>
          <span class="text-3 op-65">{{ data.counts.reviewHours === null ? $gettext('No review this week') : $gettext('Reviewed in %{d} days on average', { d: (data.counts.reviewHours / 24).toFixed(1) }) }}</span>
        </div>
        <div class="stat">
          <span class="text-3 op-65">{{ $gettext('Newest version yanked') }}</span>
          <span class="num">{{ data.counts.yanked }}</span>
          <span class="text-3 op-65">{{ $gettext('Users stay on the version before') }}</span>
        </div>
        <button type="button" class="stat clickable" @click="blockOpen = true">
          <span class="text-3 op-65">{{ $gettext('Block list') }} <span class="i-tabler-chevron-right" /></span>
          <span class="num">{{ data.counts.blocked }}</span>
          <span class="text-3 op-65">{{ lastBlocked ? $gettext('Last added %{date}', { date: fromNow(lastBlocked) }) : $gettext('Plugin ids and repositories') }}</span>
        </button>
      </div>

      <AFlex vertical gap="middle">
        <ACard :styles="{ body: { padding: 0 } }">
          <div class="toolbar">
            <ASegmented v-model:value="state" class="scroll-x" :options="[{ value: 'all', label: $gettext('All') }, { value: 'listed', label: $gettext('Listed') }, { value: 'review', label: $gettext('In review') }, { value: 'delisted', label: $gettext('Delisted') }]" />
            <AFlex gap="small" wrap>
              <ASelect v-model:value="trust" class="w-36" :options="[{ value: 'all', label: $gettext('Any trust') }, { value: 'official', label: $gettext('Official') }, { value: 'verified', label: $gettext('Partner') }, { value: 'community', label: $gettext('Community') }]" />
              <ASelect v-model:value="source" class="w-36" :options="[{ value: 'all', label: $gettext('Any source') }, { value: 'github', label: $gettext('GitHub releases') }, { value: 'vendor', label: $gettext('Vendor feed') }]" />
              <AInput v-model:value="search" allow-clear class="w-56" :placeholder="$gettext('Plugin ID, name or owner')" :aria-label="$gettext('Search')" />
            </AFlex>
          </div>
          <div class="overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ $gettext('Plugin') }}</th>
                  <th>{{ $gettext('Owner') }}</th>
                  <th>{{ $gettext('Trust') }}</th>
                  <th>{{ $gettext('Version') }}</th>
                  <th>{{ $gettext('Store source') }}</th>
                  <th>{{ $gettext('State') }}</th>
                  <th>{{ $gettext('Pending review') }}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in paged" :key="p.id">
                  <td>
                    <AFlex align="center" gap="small" class="min-w-0">
                      <PluginIcon :src="p.iconUrl" :name="localized(p.name)" :size="28" />
                      <div class="min-w-0">
                        <div class="font-600 nowrap">
                          {{ localized(p.name) }}
                        </div>
                        <div class="mono text-3 op-65 ellipsis">
                          {{ p.id }}
                        </div>
                      </div>
                    </AFlex>
                  </td>
                  <td class="nowrap">
                    {{ p.owner }}
                    <div class="text-3 op-65">
                      {{ p.ownerKind === 'vendor' ? $gettext('Vendor') : p.ownerType === 'organization' ? $gettext('GitHub organization') : p.ownerType === 'user' ? $gettext('Personal') : $gettext('GitHub') }}
                    </div>
                  </td>
                  <td>
                    <ATag v-if="p.trust" :color="p.trust === 'official' ? 'success' : p.trust === 'verified' ? 'blue' : 'default'" class="m-0">
                      {{ trustLabel(p.trust) }}
                    </ATag>
                  </td>
                  <td class="nowrap">
                    {{ p.version ? `v${p.version}` : '—' }}
                  </td>
                  <td class="text-3 op-65 nowrap">
                    {{ storeSourceShort(p.source) }}
                  </td>
                  <td class="nowrap">
                    <ATag :color="stateTag(p).color" class="m-0">
                      {{ stateTag(p).text }}
                    </ATag>
                  </td>
                  <td class="nowrap">
                    <RouterLink v-if="p.openChanges" to="/review">
                      {{ $gettext('%{n} changes', { n: String(p.openChanges) }) }}
                    </RouterLink>
                    <span v-else class="op-50">{{ $gettext('None') }}</span>
                  </td>
                  <td>
                    <ADropdown
                      :menu="{
                        items: [
                          { key: 'audit', label: $gettext('Audit records') },
                          { key: 'catalog', label: $gettext('View in catalog'), disabled: p.state !== 'listed' && p.state !== 'yanked' },
                          { key: 'trust', label: $gettext('Change the trust'), disabled: !p.trust },
                          { type: 'divider' },
                          { key: 'delist', label: $gettext('Delist, with a reason'), danger: true, disabled: p.state === 'delisted' || p.state === 'review' },
                          { key: 'block', label: $gettext('Add to the block list'), danger: true },
                        ],
                        onClick: ({ key }: { key: string | number }) => onMenu(p, String(key)),
                      }"
                      :trigger="['click']"
                    >
                      <AButton size="small" type="text" :aria-label="$gettext('More actions')">
                        <span class="i-tabler-dots" />
                      </AButton>
                    </ADropdown>
                  </td>
                </tr>
              </tbody>
            </table>
            <AEmpty v-if="!shown.length" class="py-8" :description="$gettext('No plugin matches these filters.')" />
          </div>
          <AFlex justify="space-between" align="center" class="foot">
            <span class="text-3 op-65">{{ shown.length ? $gettext('%{n} in all, showing %{a} to %{b}', { n: String(shown.length), a: String((page - 1) * PAGE + 1), b: String(Math.min(page * PAGE, shown.length)) }) : $gettext('%{n} plugins', { n: '0' }) }}</span>
            <AFlex gap="small">
              <AButton size="small" :disabled="page <= 1" @click="page--">
                {{ $gettext('Previous page') }}
              </AButton>
              <AButton size="small" :disabled="page * PAGE >= shown.length" @click="page++">
                {{ $gettext('Next page') }}
              </AButton>
            </AFlex>
          </AFlex>
        </ACard>
      </AFlex>
    </template>

    <ADrawer v-if="data" v-model:open="blockOpen" :size="420">
      <template #title>
        <span class="i-tabler-ban mr-2 op-65" />{{ $gettext('Block list') }}
      </template>
      <template #extra>
        <a :href="data.blockedUrl" target="_blank" rel="noopener" class="text-3">{{ $gettext('View on GitHub') }}</a>
      </template>
      <div v-for="b in data.blocked" :key="b.value" class="blocked">
        <span class="i-tabler-ban c-err" />
        <div class="min-w-0">
          <div class="mono text-3 break-all">
            {{ b.value }}
          </div>
          <div class="text-3 op-65">
            {{ joinClauses([b.kind === 'plugin' ? $gettext('Plugin') : $gettext('Repository'), b.reason ?? '', b.added_by ? $gettext('%{time} added by @%{login}', { time: b.added_at ? fromNow(b.added_at) : '', login: b.added_by }) : ''].filter(Boolean)) }}
          </div>
        </div>
      </div>
      <ATypographyText v-if="!data.blocked.length" type="secondary" class="text-3">
        {{ $gettext('Nothing is blocked.') }}
      </ATypographyText>
      <AButton size="small" class="mt-3" @click="start({ kind: 'block-new' })">
        <span class="i-tabler-plus" />{{ $gettext('Add an entry') }}
      </AButton>
      <ATypographyParagraph type="secondary" class="text-3 mt-4 mb-0">
        {{ joinSentences([$gettext('Delisting removes a plugin from the catalog and leaves installed copies alone. Blocking also keeps the same plugin id or repository from being listed again.'), $gettext('Both need a reason, which goes to the audit log and to the admins of the plugin.')]) }}
      </ATypographyParagraph>
    </ADrawer>

    <AModal :open="!!action" :title="title" :confirm-loading="sending" :ok-text="$gettext('Open the pull request')" :ok-button-props="{ danger: action?.kind !== 'trust' }" @ok="confirm" @cancel="action = null">
      <AForm v-if="action" layout="vertical">
        <AFormItem v-if="action.kind === 'trust'" :label="$gettext('Trust')">
          <ASegmented v-model:value="form.trust" :options="[{ value: 'official', label: $gettext('Official') }, { value: 'verified', label: $gettext('Partner') }, { value: 'community', label: $gettext('Community') }]" />
        </AFormItem>
        <template v-if="action.kind === 'block-new'">
          <AFormItem :label="$gettext('Plugin ID')">
            <AInput v-model:value="form.pluginId" class="mono" />
          </AFormItem>
          <AFormItem :label="$gettext('Repository')" :extra="$gettext('owner/repo')">
            <AInput v-model:value="form.repository" class="mono" />
          </AFormItem>
        </template>
        <template v-if="action.kind === 'delist' || action.kind === 'block'">
          <AFormItem>
            <ACheckbox v-model:checked="form.block">
              {{ $gettext('Also block it from being listed again') }}
            </ACheckbox>
          </AFormItem>
          <AFormItem v-if="form.block" :label="$gettext('Also block the repository')" :extra="$gettext('Leave empty to block the plugin id only.')">
            <AInput v-model:value="form.repository" class="mono" />
          </AFormItem>
        </template>
        <AFormItem :label="$gettext('Reason')" required>
          <ATextarea v-model:value="form.reason" :rows="3" :maxlength="500" />
        </AFormItem>
      </AForm>
      <AAlert v-if="error" type="error" show-icon :title="error" />
    </AModal>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.stat.clickable {
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color 0.2s;
}

.stat.clickable:hover,
.stat.clickable:focus-visible {
  border-color: var(--portal-primary);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--portal-card);
  border: 1px solid var(--portal-border);
}

.num {
  font-size: 22px;
  font-weight: 600;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--portal-border);
}

.table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 13px;
}

.table th {
  text-align: start;
  font-weight: 500;
  padding: 10px 12px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
  white-space: nowrap;
}

.table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: middle;
}

.nowrap {
  white-space: nowrap;
}

.ellipsis {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.foot {
  padding: 10px 16px;
}

.blocked {
  display: flex;
  gap: 8px;
  padding: 8px 0;
}

.blocked + .blocked {
  border-top: 1px solid var(--portal-border);
}

.c-err {
  color: #ff4d4f;
  margin-top: 3px;
  flex: none;
}

.break-all {
  word-break: break-all;
}
</style>
