<script setup lang="ts">
import type { CommunityState } from '@/api/community'
import type { StoreState } from '@/api/store'
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { aiDraft, aiStatus, getCommunity, getGlossary } from '@/api/community'
import { $gettext } from '@/lib/gettext'
import { HOST_LOCALES, RTL_LOCALES } from '@/lib/hostLocales'
import { localeName } from '@/lib/locales'
import { permissionText } from '@/lib/market'
import { coverageOf } from '@/lib/storeDiff'
import { fromNow } from '@/lib/time'
import { useStoreDraft } from '@/lib/useStoreDraft'
import { usePluginStore } from '@/stores/plugin'

const pluginStore = usePluginStore()
const plugin = computed(() => pluginStore.detail!.plugin)
const draft = useStoreDraft(() => plugin.value.id)
const { state, failed, doc, savedAt, saving } = draft
const S = computed(() => state.value as StoreState)

const community = ref<CommunityState | null>(null)
async function loadCommunity() {
  community.value = await getCommunity(plugin.value.id).catch(() => null)
}
watch(() => plugin.value.id, () => {
  draft.load()
  loadCommunity()
}, { immediate: true })

const ai = ref<{ enabled: boolean, remaining?: number }>({ enabled: false })
onMounted(async () => {
  ai.value = await aiStatus().catch(() => ({ enabled: false }))
})

// Columns the author picked, remembered on this device.
const picked = useLocalStorage<string[]>('portal-translation-columns', ['en', 'zh_CN', 'ja_JP', 'de_DE', 'ar'])
const columns = computed(() => HOST_LOCALES.filter(l => picked.value.includes(l)))
function toggleColumn(locale: string) {
  picked.value = picked.value.includes(locale) ? picked.value.filter(l => l !== locale) : [...picked.value, locale]
}
const coverage = computed(() => coverageOf(doc.value))
// English first, then the most complete languages.
const tilesOrder = computed(() => [...HOST_LOCALES].sort((a, b) => Number(b === 'en') - Number(a === 'en') || (coverage.value[b] ?? 0) - (coverage.value[a] ?? 0)))

interface Row {
  key: string
  label: string
}
const rows = computed<Row[]>(() => [
  { key: 'name', label: $gettext('Name') },
  { key: 'description', label: $gettext('Description') },
  ...(doc.value.screenshots ?? []).map((s, i) => ({ key: `caption:${s.id}`, label: $gettext('Caption of screenshot %{n}', { n: String(i + 1) }) })),
])

function textIn(key: string, lang: string): string {
  if (key === 'name' || key === 'description')
    return doc.value[key]?.[lang] ?? ''
  return doc.value.screenshots?.find(s => `caption:${s.id}` === key)?.caption?.[lang] ?? ''
}

const isAi = (key: string, lang: string) => draft.ai.value.includes(`${key}.${lang}`)
const suggestionsFor = (key: string, lang: string) => (community.value?.pending ?? []).filter(s => s.field === key && s.locale === lang)
const inReview = (key: string, lang: string) => key === 'name' && !!textIn(key, lang) && textIn(key, lang) !== (S.value.doc.name?.[lang] ?? '')

type Filter = 'all' | 'missing' | 'ai' | 'suggestions'
const filter = ref<Filter>('all')
const counts = computed(() => {
  let missing = 0
  let drafts = 0
  let suggestions = 0
  for (const row of rows.value) {
    for (const lang of columns.value) {
      if (lang === 'en')
        continue
      if (!textIn(row.key, lang))
        missing++
      if (isAi(row.key, lang))
        drafts++
      suggestions += suggestionsFor(row.key, lang).length
    }
  }
  return { missing, drafts, suggestions }
})
const filters = computed(() => [
  { value: 'all', label: $gettext('All') },
  { value: 'missing', label: `${$gettext('Missing')} ${counts.value.missing}` },
  { value: 'ai', label: `${$gettext('Waiting for confirmation')} ${counts.value.drafts}` },
  { value: 'suggestions', label: `${$gettext('Suggestions')} ${counts.value.suggestions}` },
])
const shownRows = computed(() => rows.value.filter((row) => {
  const langs = columns.value.filter(l => l !== 'en')
  if (filter.value === 'missing')
    return langs.some(l => !textIn(row.key, l))
  if (filter.value === 'ai')
    return langs.some(l => isAi(row.key, l))
  if (filter.value === 'suggestions')
    return langs.some(l => suggestionsFor(row.key, l).length)
  return true
}))

// Runtime strings of the manifest: shown for coverage, translated in the
// repository and shipped with a release.
const runtime = computed(() => Object.entries(S.value?.manifest?.permission_reasons ?? {}).map(([permission, en]) => ({
  key: permission,
  label: $gettext('Permission note: %{name}', { name: permissionText('en', permission).label }),
  en,
  texts: Object.fromEntries(HOST_LOCALES.map(l => [l, S.value.manifest?.i18n?.[l]?.permission_reasons?.[permission] ?? ''])),
})))

function exportRuntime() {
  const data = Object.fromEntries(HOST_LOCALES.map(l => [l, { permission_reasons: Object.fromEntries(runtime.value.map(r => [r.key, r.texts[l] || (l === 'en' ? r.en : '')]).filter(([, v]) => v)) }]))
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${plugin.value.id}-runtime-strings.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

// The cell being edited.
const cell = ref<{ key: string, locale: string } | null>(null)
const value = ref('')
const terms = ref<Record<string, string>>({})
const drafting = ref(false)
const aiError = ref('')

function pick(key: string, locale: string) {
  if (locale === 'en' && !S.value.canEdit.texts)
    return
  cell.value = { key, locale }
  value.value = textIn(key, locale)
  aiError.value = ''
}

watch(() => cell.value?.locale, async (locale) => {
  terms.value = locale && locale !== 'en' ? (await getGlossary(locale).catch(() => ({ terms: {} }))).terms : {}
})

const source = computed(() => cell.value ? textIn(cell.value.key, 'en') : '')
const usedTerms = computed(() => Object.entries(terms.value).filter(([en]) => new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(source.value)))
const cellLabel = computed(() => cell.value ? `${localeName(cell.value.locale)}: ${rows.value.find(r => r.key === cell.value!.key)?.label ?? ''}` : '')

function save() {
  if (!cell.value)
    return
  draft.setText(cell.value.key, cell.value.locale, value.value.trim(), false)
}

async function redraft() {
  if (!cell.value)
    return
  drafting.value = true
  aiError.value = ''
  try {
    const result = await aiDraft(plugin.value.id, cell.value.key, cell.value.locale, source.value)
    value.value = result.text
    ai.value = { ...ai.value, remaining: result.remaining }
    draft.setText(cell.value.key, cell.value.locale, result.text, true)
  }
  catch (e) {
    aiError.value = (e as { code?: string }).code === 'quota' ? $gettext('No AI drafts are left for today.') : $gettext('The AI draft could not be made. Please try again later.')
  }
  finally {
    drafting.value = false
  }
}

// Drafts every missing text of the picked languages, one after another.
const batch = ref<{ done: number, total: number } | null>(null)
async function draftMissing() {
  const todo = rows.value.flatMap(r => columns.value.filter(l => l !== 'en' && !textIn(r.key, l) && textIn(r.key, 'en')).map(l => ({ key: r.key, locale: l })))
  batch.value = { done: 0, total: todo.length }
  aiError.value = ''
  for (const item of todo) {
    try {
      const result = await aiDraft(plugin.value.id, item.key, item.locale, textIn(item.key, 'en'))
      draft.setText(item.key, item.locale, result.text, true)
      ai.value = { ...ai.value, remaining: result.remaining }
      batch.value.done++
    }
    catch (e) {
      aiError.value = (e as { code?: string }).code === 'quota' ? $gettext('No AI drafts are left for today.') : $gettext('The AI draft could not be made. Please try again later.')
      break
    }
  }
  batch.value = null
}
</script>

<template>
  <AFlex vertical gap="middle">
    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The store texts could not be loaded.')" />
    <ASkeleton v-else-if="!state" active />
    <template v-else>
      <ACard :title="$gettext('Languages')">
        <template #extra>
          <AFlex align="center" gap="middle" wrap>
            <span class="text-3 op-65">{{ $gettext('The %{n} interface languages of Nginx UI. Pick the columns to show.', { n: String(HOST_LOCALES.length) }) }}</span>
            <AButton v-if="ai.enabled" type="primary" :loading="!!batch" :disabled="!S.canEdit.texts" @click="draftMissing">
              <span class="i-tabler-sparkles" />
              {{ batch ? $gettext('Drafting %{done} of %{total}', { done: String(batch.done), total: String(batch.total) }) : $gettext('AI draft the missing texts') }}
            </AButton>
          </AFlex>
        </template>
        <div class="tiles">
          <button
            v-for="l in tilesOrder"
            :key="l"
            type="button"
            class="tile"
            :class="{ on: columns.includes(l) }"
            :aria-pressed="columns.includes(l)"
            @click="toggleColumn(l)"
          >
            <span class="tile-row"><span dir="auto">{{ localeName(l) }}</span><span class="text-3 op-65">{{ Math.round((coverage[l] ?? 0) * 100) }}%</span></span>
            <span class="bar"><span :style="{ width: `${(coverage[l] ?? 0) * 100}%` }" /></span>
          </button>
        </div>
        <AAlert v-if="aiError" type="warning" show-icon class="mt-3" :title="aiError" />
      </ACard>

      <ACard :styles="{ body: { padding: '12px 16px' } }">
        <AFlex justify="space-between" align="center" gap="middle" wrap>
          <ASegmented v-model:value="filter" :options="filters" />
          <span class="text-3 op-65">{{ $gettext('A text left out in a language shows in English there') }}</span>
        </AFlex>
      </ACard>

      <div class="cols">
        <ACard class="col-main" :styles="{ body: { padding: 0 } }">
          <div class="overflow-x-auto">
            <table class="wb-table">
              <thead>
                <tr>
                  <th class="field-col">
                    {{ $gettext('Text') }}
                  </th>
                  <th v-for="l in columns" :key="l" :dir="RTL_LOCALES.includes(l) ? 'rtl' : 'ltr'">
                    {{ localeName(l) }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr class="group">
                  <td :colspan="columns.length + 1">
                    {{ $gettext('Store texts, live after the merge') }}
                  </td>
                </tr>
                <tr v-for="row in shownRows" :key="row.key">
                  <td class="field-col">
                    {{ row.label }}
                  </td>
                  <td
                    v-for="l in columns"
                    :key="l"
                    :dir="RTL_LOCALES.includes(l) ? 'rtl' : 'ltr'"
                    class="cell"
                    :class="{ on: cell?.key === row.key && cell?.locale === l }"
                    role="button"
                    tabindex="0"
                    @click="pick(row.key, l)"
                    @keydown.enter="pick(row.key, l)"
                  >
                    <template v-if="textIn(row.key, l)">
                      <div class="cell-text">
                        {{ textIn(row.key, l) }}
                      </div>
                      <div class="tags">
                        <span v-if="isAi(row.key, l)" class="tag ai">{{ $gettext('AI draft') }}</span>
                        <span v-if="inReview(row.key, l)" class="tag info">{{ $gettext('Goes to review') }}</span>
                        <span v-if="suggestionsFor(row.key, l).length" class="tag warn">{{ $gettext('%{n} suggestions', { n: String(suggestionsFor(row.key, l).length) }) }}</span>
                      </div>
                    </template>
                    <span v-else class="missing"><span class="i-tabler-plus" />{{ $gettext('Add') }}</span>
                  </td>
                </tr>
                <template v-if="runtime.length">
                  <tr class="group">
                    <td :colspan="columns.length + 1">
                      {{ $gettext('Runtime strings, ship with the next release') }}
                    </td>
                  </tr>
                  <tr v-for="row in runtime" :key="row.key">
                    <td class="field-col">
                      {{ row.label }}
                    </td>
                    <td v-for="l in columns" :key="l" :dir="RTL_LOCALES.includes(l) ? 'rtl' : 'ltr'" class="cell readonly">
                      <span v-if="l === 'en' ? row.en : row.texts[l]">{{ l === 'en' ? row.en : row.texts[l] }}</span>
                      <span v-else class="op-50">{{ $gettext('Missing') }}</span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <AFlex justify="space-between" align="center" gap="middle" wrap class="foot">
            <span class="text-3 op-65">{{ $gettext('Runtime strings are translated in plugin.json in the repository. A generated plugin.json takes them from its source code; export them to translate there.') }}</span>
            <AButton v-if="runtime.length" size="small" @click="exportRuntime">
              {{ $gettext('Export runtime strings') }}
            </AButton>
          </AFlex>
          <div v-if="savedAt" class="foot text-3 op-65">
            {{ saving ? $gettext('Saving the draft') : $gettext('Draft saved %{time}. Submit it from the store page.', { time: fromNow(savedAt) }) }}
            <RouterLink :to="`/plugins/${plugin.id}`">
              {{ $gettext('Store details') }}
            </RouterLink>
          </div>
        </ACard>

        <AFlex vertical gap="middle" class="col-side">
          <ACard v-if="cell" :title="cellLabel">
            <template #extra>
              <span v-if="isAi(cell.key, cell.locale)" class="tag ai">{{ $gettext('AI draft') }}</span>
            </template>
            <div v-if="cell.locale !== 'en'" class="mb-3">
              <div class="text-3 op-65">
                {{ $gettext('English') }}
              </div>
              <p class="m-0 mt-1 text-3">
                {{ source || $gettext('There is no English text yet') }}
              </p>
            </div>
            <div class="text-3 op-65 mb-1">
              {{ $gettext('Translation') }}
            </div>
            <ATextarea v-model:value="value" :rows="cell.key === 'description' ? 6 : 2" :dir="RTL_LOCALES.includes(cell.locale) ? 'rtl' : 'auto'" :disabled="!S.canEdit.texts" @blur="save" />
            <div v-if="usedTerms.length" class="text-3 op-65 mt-2">
              {{ $gettext('Terms as Nginx UI translates them: %{terms}', { terms: usedTerms.map(([en, tr]) => `${en} → ${tr}`).join(', ') }) }}
            </div>
            <AFlex gap="small" wrap class="mt-3">
              <AButton v-if="isAi(cell.key, cell.locale)" type="primary" @click="draft.confirm(cell.key, cell.locale)">
                {{ $gettext('Confirm the translation') }}
              </AButton>
              <AButton v-else type="primary" :disabled="!S.canEdit.texts" @click="save">
                {{ $gettext('Save') }}
              </AButton>
              <AButton v-if="ai.enabled && cell.locale !== 'en' && source" :loading="drafting" @click="redraft">
                <span class="i-tabler-refresh" />
                {{ isAi(cell.key, cell.locale) || textIn(cell.key, cell.locale) ? $gettext('Draft again') : $gettext('AI draft') }}
              </AButton>
            </AFlex>
            <div v-if="ai.enabled && ai.remaining !== undefined" class="text-3 op-65 mt-2">
              {{ $gettext('AI drafts left today: %{n}', { n: String(ai.remaining) }) }}
            </div>
          </ACard>
          <ACard v-else>
            <ATypographyText type="secondary" class="text-3">
              {{ $gettext('Pick a cell to translate it.') }}
            </ATypographyText>
          </ACard>

          <CommunityCard v-if="community" :plugin-id="plugin.id" :state="community" :doc="doc" :store-source="S.source" @changed="loadCommunity" />
        </AFlex>
      </div>
    </template>
  </AFlex>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.tile {
  all: unset;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--portal-border-strong);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.tile.on {
  border-color: var(--portal-primary);
  background: var(--portal-primary-bg);
}

.tile:focus-visible {
  outline: 2px solid var(--portal-primary);
}

.tile-row {
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.bar {
  height: 4px;
  border-radius: 2px;
  background: var(--portal-border);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--portal-primary);
}

.wb-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

.wb-table th {
  text-align: start;
  font-weight: 500;
  padding: 10px 12px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
}

.wb-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: top;
}

.field-col {
  width: 140px;
}

.group td {
  padding: 6px 12px;
  font-size: 12px;
  opacity: 0.65;
  background: var(--portal-faint);
}

.cell {
  cursor: pointer;
}

.cell:hover {
  background: var(--portal-faint);
}

.cell.on {
  box-shadow: inset 0 0 0 2px var(--portal-primary);
}

.cell.readonly {
  cursor: default;
}

.cell-text {
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.tag {
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 18px;
}

.tag.ai {
  color: #722ed1;
  background: #f9f0ff;
}

.tag.info {
  color: var(--portal-primary-text);
  background: var(--portal-primary-bg);
}

.tag.warn {
  color: #d48806;
  background: #fffbe6;
}

:global(html.dark) .tag.ai {
  color: #b37feb;
  background: #1a1325;
}

:global(html.dark) .tag.warn {
  color: #e8b339;
  background: #2b2111;
}

.missing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px dashed #faad14;
  border-radius: 6px;
  color: #d48806;
  font-size: 12px;
}

.foot {
  padding: 12px 16px;
}
</style>
