<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import gettext, { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { localeName } from '@/lib/locales'
import { permissionText } from '@/lib/market'
import { fromNow } from '@/lib/time'
import { usePluginStore } from '@/stores/plugin'

interface DiffRow { sign: 'add' | 'del' | 'mod', kind: string, subject: string, from?: string, to?: string, note?: string, attention?: string }
interface Check { key: string, status: 'pass' | 'fail' | 'warn', params?: Record<string, string> }
interface Result {
  ref: string
  listed: { tag: string | null, version: string | null }
  version: string | null
  unchanged: { permissions: number }
  runtime: { permissions: DiffRow[], capabilities: DiffRow[], compatibility: DiffRow[] }
  store: DiffRow[]
  storeFromDocument: boolean
  checks: Check[]
  dialog: { from: string | null, to: string | null, added: { kind: string, subject: string }[] }
  releaseUrl: string | null
}
interface Refs {
  default: { name: string, sha: string, date: string | null }
  branches: { name: string, sha: string }[]
  tags: { name: string, sha: string }[]
  listed: { tag: string | null, version: string | null }
}

const store = usePluginStore()
const plugin = computed(() => store.detail!.plugin)
const refs = ref<Refs | null>(null)
const target = ref('')
const result = ref<Result | null>(null)
const loading = ref(false)
const failed = ref('')

watch(() => plugin.value.id, async (id) => {
  refs.value = await api<Refs>(`/plugins/${encodeURIComponent(id)}/preflight/refs`).catch(() => null)
  if (refs.value) {
    target.value = refs.value.default.name
    run()
  }
}, { immediate: true })

async function run() {
  if (!target.value)
    return
  loading.value = true
  failed.value = ''
  try {
    result.value = await api<Result>(`/plugins/${encodeURIComponent(plugin.value.id)}/preflight?ref=${encodeURIComponent(target.value)}`)
  }
  catch {
    failed.value = $gettext('The ref could not be read. Check that it exists in the repository.')
  }
  finally {
    loading.value = false
  }
}

const options = computed(() => {
  const r = refs.value
  if (!r)
    return []
  return [
    { label: $gettext('Branches'), options: r.branches.map(b => ({ value: b.name, label: b.name === r.default.name ? $gettext('Branch %{name}, %{sha}, %{time}', { name: b.name, sha: b.sha.slice(0, 7), time: r.default.date ? fromNow(r.default.date) : '' }) : $gettext('Branch %{name}, %{sha}', { name: b.name, sha: b.sha.slice(0, 7) }) })) },
    { label: $gettext('Tags'), options: r.tags.map(t => ({ value: t.name, label: $gettext('Tag %{name}', { name: t.name }) })) },
  ]
})

const lang = computed(() => gettext.current)
const permissionsAttention = computed(() => result.value?.runtime.permissions.some(r => r.sign === 'add'))
const compatibilityAttention = computed(() => result.value?.runtime.compatibility.some(r => r.attention))

function title(row: DiffRow): string {
  switch (row.kind) {
    case 'permission': return $gettext('Permission %{name}', { name: permissionText(lang.value, row.subject).label })
    case 'network_host': return $gettext('Network host')
    case 'capability': return $gettext('Capability')
    case 'min_nginx_ui_version': return $gettext('Required Nginx UI version %{from} to %{to}', { from: row.from || $gettext('any'), to: row.to || $gettext('any') })
    case 'setting': return $gettext('Setting')
    case 'setting_default': return $gettext('Default of the setting')
    case 'conflict': return $gettext('Cannot be enabled together with')
    case 'name': return row.sign === 'add' ? $gettext('Name in %{lang}', { lang: localeName(row.subject) }) : $gettext('Name in %{lang}: %{from} to %{to}', { lang: localeName(row.subject), from: row.from ?? '', to: row.to ?? '' })
    case 'description': return $gettext('Description in %{lang}', { lang: localeName(row.subject) })
    case 'screenshot': return row.sign === 'del' ? $gettext('Screenshot removed') : row.sign === 'add' ? $gettext('New screenshot') : $gettext('Screenshot image changed')
    default: return row.kind
  }
}

function code(row: DiffRow): string {
  if (row.kind === 'min_nginx_ui_version' || row.kind === 'name' || row.kind === 'description')
    return ''
  if (row.kind === 'permission')
    return row.subject
  return row.subject
}

function detail(row: DiffRow): string {
  if (row.kind === 'permission' && row.sign === 'add')
    return row.note ? $gettext('Note from the author: %{note}', { note: row.note }) : $gettext('The manifest gives no reason for it. Add one in permission_reasons.')
  if (row.kind === 'min_nginx_ui_version')
    return $gettext('Users of an older Nginx UI stay on v%{version}', { version: result.value?.listed.version ?? '' })
  if (row.kind === 'name' && row.attention === 'review')
    return $gettext('Goes to name review once released, the listed name shows until it is approved')
  if (row.attention === 'left_out')
    return row.kind === 'name' ? $gettext('Holds a word no name may hold and would not be listed') : $gettext('Claims to be official and would be left out')
  if (row.kind === 'setting' && row.note)
    return row.note
  if (row.kind === 'setting_default')
    return `${row.from} → ${row.to}`
  if (row.kind === 'screenshot' && row.to)
    return row.to
  return ''
}

function badge(row: DiffRow): { text: string, color: string } | null {
  switch (row.attention) {
    case 'new': return { text: $gettext('New'), color: 'warning' }
    case 'affects_updates': return { text: $gettext('Affects updates'), color: 'warning' }
    case 'review': return { text: $gettext('Reviewed'), color: 'blue' }
    case 'left_out': return { text: $gettext('Left out'), color: 'error' }
    default: return null
  }
}

function checkText(check: Check): { title: string, detail?: string } {
  const p = check.params ?? {}
  if (check.key === 'manifest') {
    if (check.status === 'pass')
      return { title: $gettext('The manifest is valid, version %{version} is newer than the listed one', { version: p.version }) }
    if (p.reason === 'missing')
      return { title: $gettext('There is no plugin.json at this ref') }
    if (p.reason === 'id')
      return { title: $gettext('The manifest names another plugin: %{id}', { id: p.id }) }
    return { title: $gettext('Version %{version} is not newer than the listed %{listed}', { version: p.version || '?', listed: p.listed }), detail: $gettext('Raise the version before releasing.') }
  }
  if (check.key === 'signer') {
    if (check.status === 'pass')
      return { title: $gettext('The signer certificate was issued by your primary key') }
    if (p.reason === 'missing')
      return { title: $gettext('There is no signer certificate at this ref'), detail: $gettext('Packages signed without one are not listed.') }
    if (p.reason === 'other_plugin')
      return { title: $gettext('The signer certificate was issued for another plugin: %{id}', { id: p.id }) }
    return { title: $gettext('The signer certificate was issued by another primary key: %{key}', { key: p.key }) }
  }
  const problem = p.problem ?? ''
  const [kind, value] = problem.split(':')
  const why = kind === 'size' ? $gettext('it is %{mb} MB, more than 2 MB', { mb: (Number(value) / 1048576).toFixed(1) }) : kind === 'type' ? $gettext('it is not PNG, JPEG or WebP') : $gettext('it cannot be loaded')
  return { title: $gettext('Screenshot %{id}: %{why}', { id: p.id, why }), detail: $gettext('Once released this screenshot would not show.') }
}

const name = computed(() => localized(plugin.value.name))
const SIGNS = { add: '+', del: '−', mod: '~' }
</script>

<template>
  <AFlex vertical gap="middle">
    <ACard :styles="{ body: { padding: '12px 16px' } }">
      <AFlex justify="space-between" align="center" gap="middle" wrap>
        <AFlex align="center" gap="middle" wrap>
          <span class="text-3 op-65">{{ $gettext('Compare') }}</span>
          <ASelect v-model:value="target" class="ref-select" show-search :options="options" :aria-label="$gettext('Branch or tag')" @change="run" />
          <span class="i-tabler-arrow-right op-50" />
          <span class="text-3 op-65">{{ $gettext('Listed') }}</span>
          <ATag class="m-0">
            {{ refs?.listed.version ? `v${refs.listed.version}` : $gettext('Nothing listed') }}
          </ATag>
        </AFlex>
        <AButton :loading="loading" @click="run">
          <span class="i-tabler-refresh" />{{ $gettext('Check again') }}
        </AButton>
      </AFlex>
    </ACard>

    <AAlert v-if="failed" type="error" show-icon :title="failed" />
    <ASkeleton v-if="!result && !failed" active />

    <div v-if="result" class="cols">
      <AFlex vertical gap="middle" class="col-main">
        <ACard>
          <template #title>
            <span class="i-tabler-shield mr-2 op-65" />{{ $gettext('Permissions and network') }}
          </template>
          <template #extra>
            <ATag v-if="permissionsAttention" color="warning" class="m-0">
              {{ $gettext('Needs attention') }}
            </ATag>
          </template>
          <div v-for="(row, i) in result.runtime.permissions" :key="i" class="diff">
            <span class="sign" :class="row.sign">{{ SIGNS[row.sign] }}</span>
            <div class="min-w-0 flex-1">
              <AFlex gap="small" align="center" wrap>
                <span>{{ title(row) }}</span>
                <code v-if="code(row)" class="code">{{ code(row) }}</code>
                <ATag v-if="badge(row)" :color="badge(row)!.color" class="m-0">
                  {{ badge(row)!.text }}
                </ATag>
              </AFlex>
              <div v-if="detail(row)" class="text-3 op-65 mt-1">
                {{ detail(row) }}
              </div>
            </div>
          </div>
          <ATypographyText v-if="!result.runtime.permissions.length" type="secondary" class="text-3">
            {{ $gettext('No permission or network host changes.') }}
          </ATypographyText>
          <div v-if="result.unchanged.permissions" class="text-3 op-65 mt-2">
            {{ $gettext('%{n} permissions stay as they are', { n: String(result.unchanged.permissions) }) }}
          </div>
        </ACard>

        <ACard :title="$gettext('Compatibility and settings')">
          <template #extra>
            <ATag v-if="compatibilityAttention" color="warning" class="m-0">
              {{ $gettext('Affects updates') }}
            </ATag>
          </template>
          <div v-for="(row, i) in [...result.runtime.compatibility, ...result.runtime.capabilities]" :key="i" class="diff">
            <span class="sign" :class="row.sign">{{ SIGNS[row.sign] }}</span>
            <div class="min-w-0 flex-1">
              <AFlex gap="small" align="center" wrap>
                <span>{{ title(row) }}</span>
                <code v-if="code(row)" class="code">{{ code(row) }}</code>
                <ATag v-if="badge(row)" :color="badge(row)!.color" class="m-0">
                  {{ badge(row)!.text }}
                </ATag>
              </AFlex>
              <div v-if="detail(row)" class="text-3 op-65 mt-1">
                {{ detail(row) }}
              </div>
            </div>
          </div>
          <ATypographyText v-if="!result.runtime.compatibility.length && !result.runtime.capabilities.length" type="secondary" class="text-3">
            {{ $gettext('No compatibility or settings changes.') }}
          </ATypographyText>
        </ACard>

        <ACard :title="$gettext('Store texts')">
          <template #extra>
            <span class="text-3 op-65">{{ result.storeFromDocument ? $gettext('From plugin.store.json') : $gettext('From plugin.json') }}</span>
          </template>
          <div v-for="(row, i) in result.store" :key="i" class="diff">
            <span class="sign" :class="row.sign">{{ SIGNS[row.sign] }}</span>
            <div class="min-w-0 flex-1">
              <AFlex gap="small" align="center" wrap>
                <span>{{ title(row) }}</span>
                <code v-if="row.kind === 'screenshot'" class="code">{{ row.subject }}</code>
                <ATag v-if="badge(row)" :color="badge(row)!.color" class="m-0">
                  {{ badge(row)!.text }}
                </ATag>
              </AFlex>
              <div v-if="detail(row)" class="text-3 op-65 mt-1">
                {{ detail(row) }}
              </div>
            </div>
          </div>
          <ATypographyText v-if="!result.store.length" type="secondary" class="text-3">
            {{ $gettext('The store texts stay as they are.') }}
          </ATypographyText>
        </ACard>

        <ACard :title="$gettext('Checks')">
          <div v-for="(check, i) in result.checks" :key="i" class="diff">
            <span :class="check.status === 'pass' ? 'i-tabler-circle-check c-ok' : check.status === 'warn' ? 'i-tabler-alert-triangle c-warn' : 'i-tabler-circle-x c-err'" class="text-5" />
            <div class="min-w-0 flex-1">
              <div>{{ checkText(check).title }}</div>
              <div v-if="checkText(check).detail" class="text-3 op-65 mt-1">
                {{ checkText(check).detail }}
              </div>
            </div>
          </div>
        </ACard>
      </AFlex>

      <AFlex vertical gap="middle" class="col-side">
        <ACard :title="$gettext('What users see when they update')">
          <div class="dialog">
            <AFlex gap="small" align="center">
              <PluginIcon :src="plugin.iconUrl" :name="name" :size="32" />
              <div>
                <div class="font-500">
                  {{ $gettext('Update %{name}', { name }) }}
                </div>
                <div class="text-3 op-65">
                  {{ result.dialog.from ?? '?' }} → {{ result.dialog.to ?? '?' }}
                </div>
              </div>
            </AFlex>
            <template v-if="result.dialog.added.length">
              <div class="font-500 text-3 mt-3">
                {{ $gettext('New in this version') }}
              </div>
              <ul class="added">
                <li v-for="a in result.dialog.added" :key="`${a.kind}:${a.subject}`">
                  {{ a.kind === 'network_host' ? $gettext('Connects to %{host}', { host: a.subject }) : permissionText(lang, a.subject).label }}
                </li>
              </ul>
            </template>
            <div v-else class="text-3 op-65 mt-3">
              {{ $gettext('Nothing new to approve.') }}
            </div>
            <AFlex justify="flex-end" gap="small" class="mt-3">
              <AButton size="small" disabled>
                {{ $gettext('Later') }}
              </AButton>
              <AButton size="small" type="primary" disabled>
                {{ $gettext('Update') }}
              </AButton>
            </AFlex>
          </div>
          <ATypographyParagraph type="secondary" class="text-3 mt-3 mb-0">
            {{ $gettext('New permissions and network hosts are explained to users before they update, and maintainers look at them first.') }}
          </ATypographyParagraph>
        </ACard>
        <ACard v-if="result.releaseUrl">
          <AButton type="primary" block :href="result.releaseUrl" target="_blank">
            <span class="i-tabler-brand-github" />
            {{ $gettext('Create the v%{version} release on GitHub', { version: result.version ?? '' }) }}
          </AButton>
          <div class="text-3 op-65 mt-2">
            {{ $gettext('The catalog lists it within minutes of its release.') }}
          </div>
        </ACard>
      </AFlex>
    </div>
  </AFlex>
</template>

<style scoped>
.ref-select {
  width: 300px;
  max-width: 100%;
}

.diff {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  font-size: 13px;
}

.diff + .diff {
  border-top: 1px solid var(--portal-border);
}

.sign {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.sign.add {
  color: #389e0d;
  background: #f6ffed;
}

.sign.del {
  color: #cf1322;
  background: #fff1f0;
}

.sign.mod {
  color: #d48806;
  background: #fffbe6;
}

:global(html.dark) .sign.add {
  color: #6abe39;
  background: #162312;
}

:global(html.dark) .sign.del {
  color: #e86e6b;
  background: #2a1215;
}

:global(html.dark) .sign.mod {
  color: #e8b339;
  background: #2b2111;
}

.code {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--portal-faint);
  border: 1px solid var(--portal-border);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.dialog {
  padding: 14px;
  border: 1px solid var(--portal-border-strong);
  border-radius: 10px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
}

.added {
  margin: 6px 0 0;
  padding-inline-start: 18px;
  font-size: 13px;
}

.c-ok {
  color: #52c41a;
}

.c-warn {
  color: #faad14;
}

.c-err {
  color: #ff4d4f;
}
</style>
