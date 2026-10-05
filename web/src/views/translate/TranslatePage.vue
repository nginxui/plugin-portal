<script setup lang="ts">
import type { TranslatePlugin, TranslatorOverview } from '@/api/community'
import { computed, onMounted, ref, watch } from 'vue'
import { getGlossary, getTranslatePlugin, getTranslator, setTranslatorLangs, suggest } from '@/api/community'
import gettext, { $gettext } from '@/lib/gettext'
import { termsIn } from '@/lib/glossary'
import { HOST_LOCALES, RTL_LOCALES } from '@/lib/hostLocales'
import { joinClauses, localized } from '@/lib/labels'
import { localeName } from '@/lib/locales'
import { fromNow } from '@/lib/time'

// The translator page (spec 9): the languages the user translates, plugins
// open to community translation that lack them, a grid to suggest in, and the
// user's suggestions through review.

const overview = ref<TranslatorOverview | null>(null)
const failed = ref(false)
const sort = ref<'missing' | 'installs' | 'updated'>('missing')
const lang = ref<string | null>(null)

async function load() {
  try {
    overview.value = await getTranslator()
    if (!lang.value || !overview.value.langs.includes(lang.value))
      lang.value = overview.value.langs[0] ?? null
  }
  catch {
    failed.value = true
  }
}
onMounted(load)

const others = HOST_LOCALES.filter(l => l !== 'en')
const adding = ref(false)
async function setLangs(locales: string[]) {
  const result = await setTranslatorLangs(locales)
  if (overview.value)
    overview.value.langs = result.locales
  if (!lang.value || !result.locales.includes(lang.value))
    lang.value = result.locales[0] ?? null
  load()
}

const plugins = computed(() => {
  const list = (overview.value?.open ?? []).filter(p => !lang.value || !p.locales || p.locales.includes(lang.value))
  return [...list].sort((a, b) => sort.value === 'missing' ? b.missing - a.missing : sort.value === 'installs' ? b.installs - a.installs : b.updatedAt - a.updatedAt)
})

const missingText = (n: number) => $gettext('%{n} missing', { n: String(n) })
const translateLabel = () => $gettext('Translate')

function speed(hours: number | null) {
  if (hours === null)
    return $gettext('No suggestion reviewed yet')
  if (hours <= 48)
    return $gettext('Usually reviews within two days')
  if (hours <= 168)
    return $gettext('Usually reviews within a week')
  return $gettext('Reviews take longer than a week')
}

// The grid of one plugin.
const current = ref<TranslatePlugin | null>(null)
const values = ref<Record<string, string>>({})
const sending = ref(false)
const sent = ref('')
const error = ref('')

async function open(id: string) {
  current.value = await getTranslatePlugin(id).catch(() => null)
  values.value = Object.fromEntries((current.value?.mine ?? []).filter(m => m.locale === lang.value).map(m => [m.field, m.text]))
  sent.value = ''
  error.value = ''
}
watch(lang, () => {
  if (current.value)
    open(current.value.pluginId)
})

function fieldLabel(field: string, index: number) {
  if (field === 'name')
    return $gettext('Name')
  if (field === 'description')
    return $gettext('Description')
  return $gettext('Caption of screenshot %{n}', { n: String(index - 1) })
}

const changed = computed(() => Object.entries(values.value).filter(([field, text]) => {
  const row = current.value?.rows.find(r => r.field === field)
  return text.trim() && text.trim() !== (row?.all[lang.value!] ?? '')
}))

async function send() {
  if (!current.value || !lang.value)
    return
  sending.value = true
  error.value = ''
  try {
    for (const [field, text] of changed.value)
      await suggest(current.value.pluginId, field, lang.value, text.trim())
    sent.value = $gettext('%{n} suggestions sent for review.', { n: String(changed.value.length) })
    await load()
  }
  catch {
    error.value = $gettext('Some suggestions could not be sent. Check them for words a name may not hold.')
  }
  finally {
    sending.value = false
  }
}

const terms = ref<Record<string, string>>({})
watch(lang, async (value) => {
  terms.value = value ? (await getGlossary(value).catch(() => ({ terms: {} }))).terms : {}
}, { immediate: true })
// Only the terms the plugin's English texts use.
const usedTerms = computed(() => termsIn(terms.value, (current.value?.rows ?? []).map(r => r.en ?? '').join('\n')))

// The glossary is keyed by the English terms; show them in the language of
// the portal when Nginx UI translates them.
const uiTerms = ref<Record<string, string>>({})
watch(() => gettext.current, async (value) => {
  uiTerms.value = value !== 'en' ? (await getGlossary(value).catch(() => ({ terms: {} }))).terms : {}
}, { immediate: true })

const PROGRESS: Record<string, { text: (n: number | null) => string, track: string[] }> = {
  pending: { text: () => $gettext('Waiting for review'), track: ['done', 'cur', '', '', ''] },
  accepted: { text: n => n ? $gettext('Accepted, waiting for the merge in pull request #%{n}', { n: String(n) }) : $gettext('Accepted, waiting for the merge'), track: ['done', 'done', 'done', 'cur', ''] },
  merged: { text: () => $gettext('Merged, listed at the next catalog update'), track: ['done', 'done', 'done', 'done', 'cur'] },
  live: { text: () => $gettext('Listed'), track: ['done', 'done', 'done', 'done', 'done'] },
}
</script>

<template>
  <div class="page">
    <div>
      <h1 class="page-title">
        {{ $gettext('Contribute translations') }}
      </h1>
      <ATypographyText type="secondary">
        {{ $gettext('Suggest translations for plugins that welcome community translation. Accepted suggestions go to the plugin repository with you as a co-author.') }}
      </ATypographyText>
    </div>
    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The page could not be loaded.')" />

    <ACard :styles="{ body: { padding: '12px 16px' } }">
      <AFlex justify="space-between" align="center" gap="middle" wrap>
        <AFlex align="center" gap="small" wrap>
          <span class="text-3 op-65">{{ $gettext('My languages') }}</span>
          <ATag
            v-for="l in overview?.langs ?? []"
            :key="l"
            :color="l === lang ? 'blue' : 'default'"
            closable
            class="m-0 lang-tag"
            role="button"
            @click="lang = l"
            @close.prevent="setLangs((overview?.langs ?? []).filter(x => x !== l))"
          >
            {{ localeName(l) }}
          </ATag>
          <ASelect
            v-if="adding"
            class="w-40"
            size="small"
            show-search
            :placeholder="$gettext('Add a language')"
            :options="others.filter(l => !(overview?.langs ?? []).includes(l)).map(l => ({ value: l, label: localeName(l) }))"
            @change="(v: string) => { adding = false; setLangs([...(overview?.langs ?? []), v]) }"
          />
          <AButton v-else type="link" size="small" @click="adding = true">
            <span class="i-tabler-plus" />{{ $gettext('Add') }}
          </AButton>
        </AFlex>
        <ASegmented v-model:value="sort" :options="[{ value: 'missing', label: $gettext('Most missing') }, { value: 'installs', label: $gettext('Most installed') }, { value: 'updated', label: $gettext('Recently updated') }]" />
      </AFlex>
    </ACard>

    <AEmpty v-if="overview && !overview.langs.length" :description="$gettext('Add a language you translate to see the plugins that need it.')" />

    <div v-else class="cols">
      <AFlex vertical gap="middle" class="col-main">
        <ACard :title="lang ? $gettext('Plugins that need %{lang}', { lang: localeName(lang) }) : ''">
          <template #extra>
            <span class="text-3 op-65">{{ $gettext('%{n} plugins welcome community translation', { n: String(overview?.open.length ?? 0) }) }}</span>
          </template>
          <AEmpty v-if="!plugins.length" :image-style="{ height: '40px' }" :description="$gettext('No plugin is open to community translation in this language yet.')" />
          <div v-for="p in plugins" :key="p.pluginId" class="need">
            <PluginIcon :src="p.iconUrl" :name="localized(p.name)" :size="32" />
            <div class="min-w-0 flex-1">
              <div class="font-500">
                {{ localized(p.name) }}
              </div>
              <div class="text-3 op-65">
                {{ joinClauses([p.owner ? `@${p.owner}` : '', speed(p.reviewHours)].filter(Boolean)) }}
              </div>
            </div>
            <ATag v-if="p.missing" color="warning" class="m-0">
              {{ missingText(p.missing) }}
            </ATag>
            <ATag v-else color="success" class="m-0">
              {{ $gettext('Complete') }}
            </ATag>
            <AButton size="small" :type="current?.pluginId === p.pluginId ? 'primary' : 'default'" @click="open(p.pluginId)">
              {{ translateLabel() }}
            </AButton>
          </div>
        </ACard>

        <ACard v-if="current && lang" :title="`${localized(current.name)}, ${localeName(lang)}`" :styles="{ body: { padding: 0 } }">
          <template #extra>
            <span class="text-3 op-65">{{ $gettext('Fill in only what you add or change') }}</span>
          </template>
          <div class="overflow-x-auto">
            <table class="tr-table">
              <thead>
                <tr>
                  <th class="w-30">
                    {{ $gettext('Text') }}
                  </th>
                  <th>English</th>
                  <th>{{ $gettext('Current translation') }}</th>
                  <th class="w-80">
                    {{ $gettext('Your suggestion') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in current.rows.filter(r => r.en)" :key="row.field">
                  <td>{{ fieldLabel(row.field, i) }}</td>
                  <td>{{ row.en }}</td>
                  <td :dir="RTL_LOCALES.includes(lang) ? 'rtl' : 'ltr'">
                    <span v-if="row.all[lang]">{{ row.all[lang] }}</span>
                    <span v-else class="op-50">{{ $gettext('Missing') }}</span>
                  </td>
                  <td>
                    <span v-if="row.field === 'name' && current.nameLocked" class="text-3 op-65">{{ $gettext('In review, no suggestions for now') }}</span>
                    <ATextarea
                      v-else
                      v-model:value="values[row.field]"
                      :auto-size="{ minRows: 1, maxRows: 6 }"
                      :dir="RTL_LOCALES.includes(lang) ? 'rtl' : 'auto'"
                      :maxlength="row.field === 'name' ? 64 : row.field === 'description' ? 1000 : 200"
                      :placeholder="$gettext('No change')"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <AFlex justify="space-between" align="center" gap="middle" wrap class="foot">
            <span class="text-3 op-65">{{ $gettext('A translator or publisher of the plugin reviews your suggestions.') }}</span>
            <AButton type="primary" :loading="sending" :disabled="!changed.length" @click="send">
              {{ $gettext('Send %{n} suggestions', { n: String(changed.length) }) }}
            </AButton>
          </AFlex>
          <AAlert v-if="sent" type="success" show-icon class="mx-4 mb-4" :title="sent" />
          <AAlert v-if="error" type="error" show-icon class="mx-4 mb-4" :title="error" />
        </ACard>
      </AFlex>

      <AFlex vertical gap="middle" class="col-side">
        <ACard :title="$gettext('My contributions')">
          <div class="stats">
            <div class="stat">
              <span class="text-3 op-65">{{ $gettext('Accepted') }}</span>
              <span class="num">{{ (overview?.counts.accepted ?? 0) + (overview?.counts.merged ?? 0) }}</span>
            </div>
            <div class="stat">
              <span class="text-3 op-65">{{ $gettext('Pending') }}</span>
              <span class="num">{{ overview?.counts.pending ?? 0 }}</span>
            </div>
            <div class="stat">
              <span class="text-3 op-65">{{ $gettext('Not accepted') }}</span>
              <span class="num">{{ overview?.counts.declined ?? 0 }}</span>
            </div>
          </div>
          <div class="timeline mt-4">
            <div v-for="(d, i) in overview?.decisions ?? []" :key="i" class="tl-item">
              <span class="tl-dot" :class="d.state === 'accepted' ? 'ok' : 'gray'" />
              <div class="min-w-0">
                <div>
                  {{ d.state === 'accepted'
                    ? $gettext('@%{login} accepted %{n} of your suggestions for %{name}', { login: d.decider ?? '', n: String(d.count), name: localized(d.name) })
                    : $gettext('@%{login} did not accept %{n} of your suggestions for %{name}', { login: d.decider ?? '', n: String(d.count), name: localized(d.name) }) }}
                </div>
                <div class="text-3 op-65">
                  {{ fromNow(d.at) }}<template v-if="d.state === 'declined' && d.reason">
                    , {{ $gettext('Reason: %{reason}', { reason: d.reason }) }}
                  </template>
                </div>
              </div>
            </div>
          </div>
        </ACard>
        <ACard v-if="overview?.progress?.length" :title="$gettext('Suggestion progress')">
          <div v-for="p in overview.progress" :key="p.pluginId" class="prog">
            <PluginIcon :src="p.iconUrl" :name="localized(p.name)" :size="36" />
            <div class="min-w-0 flex-1">
              <div class="font-500">
                {{ $gettext('%{name}, %{n}', { name: localized(p.name), n: String(p.count) }) }}
              </div>
              <AFlex align="center" gap="small" class="text-3 mt-1">
                <span class="mini-track"><span v-for="(st, i) in PROGRESS[p.state].track" :key="i" :class="st" /></span>
                <span :class="p.state === 'live' ? 'c-ok' : 'op-65'">{{ PROGRESS[p.state].text(p.prNumber) }}</span>
              </AFlex>
            </div>
          </div>
        </ACard>
        <ACard v-if="lang && usedTerms.length" :title="$gettext('Glossary')">
          <template #extra>
            <span class="text-3 op-65">{{ $gettext('As Nginx UI translates them') }}</span>
          </template>
          <dl class="kv">
            <template v-for="[en, tr] in usedTerms" :key="en">
              <dt>{{ uiTerms[en] ?? en }}</dt>
              <dd>{{ tr }}</dd>
            </template>
          </dl>
        </ACard>
        <ACard>
          <div class="font-500 text-3">
            {{ $gettext('Name suggestions') }}
          </div>
          <div class="text-3 op-65 mt-1">
            {{ $gettext('An accepted name still goes to a maintainer before it is listed.') }}
          </div>
        </ACard>
      </AFlex>
    </div>
  </div>
</template>

<style scoped>
.lang-tag {
  cursor: pointer;
}

.prog {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.prog + .prog {
  border-top: 1px solid var(--portal-border);
}

.mini-track {
  display: inline-flex;
  gap: 3px;
  flex: none;
}

.mini-track span {
  width: 14px;
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

.c-ok {
  color: #389e0d;
}

.need {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.need + .need {
  border-top: 1px solid var(--portal-border);
}

.tr-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 13px;
}

.tr-table th {
  text-align: start;
  font-weight: 500;
  padding: 10px 12px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
}

.tr-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: top;
  overflow-wrap: anywhere;
}

.foot {
  padding: 12px 16px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--portal-faint);
  box-shadow: inset 0 0 0 1px var(--portal-border);
}

.num {
  font-size: 18px;
  font-weight: 600;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
}

.tl-item {
  display: flex;
  gap: 10px;
}

.tl-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: #faad14;
}

.tl-dot.info {
  background: var(--portal-primary);
}

.tl-dot.ok {
  background: #52c41a;
}

.tl-dot.gray {
  background: var(--portal-border-strong);
}

.kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0;
  font-size: 13px;
}

.kv dt {
  opacity: 0.65;
}

.kv dd {
  margin: 0;
}
</style>
