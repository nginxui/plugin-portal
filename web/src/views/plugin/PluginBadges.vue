<script setup lang="ts">
import type { BadgeKind, BadgePlugin } from '@/lib/badges'
import { useClipboard } from '@vueuse/core'
import { computed, ref } from 'vue'
import { BADGE_KINDS, BADGE_LOCALES, BADGE_STRINGS, badgeContent, badgeDataUrl, badgeSvg } from '@/lib/badges'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { localeName } from '@/lib/locales'
import { usePluginStore } from '@/stores/plugin'

// README badges (spec 11.3): the catalog renders them with every deploy; this
// page picks which to show and builds the snippet to paste.

const store = usePluginStore()
const detail = computed(() => store.detail!)
const plugin = computed(() => detail.value.plugin)

const style = ref<'' | 'square' | 'large'>('')
const locale = ref('en')
const format = ref<'markdown' | 'html'>('markdown')
const theme = ref<'light' | 'dark'>('light')
const picked = ref<BadgeKind[]>(['status', 'version', 'translations'])

function togglePick(kind: BadgeKind, on: boolean) {
  picked.value = on ? BADGE_KINDS.filter(k => picked.value.includes(k) || k === kind) : picked.value.filter(k => k !== kind)
}

const source = computed<BadgePlugin>(() => ({
  name: plugin.value.name,
  description: plugin.value.description,
  releases: detail.value.releases.map(r => ({ version: r.version, yanked: r.yanked, minNginxUiVersion: r.minNginxUiVersion })),
}))

const KIND_LABELS = computed<Record<BadgeKind, string>>(() => ({
  status: $gettext('Listing state'),
  version: $gettext('Newest version'),
  translations: $gettext('Translation coverage'),
  requires: $gettext('Required Nginx UI version'),
}))

function image(kind: BadgeKind, lang: string, s = style.value) {
  const { label, value, color } = badgeContent(source.value, kind, lang)
  return badgeDataUrl(badgeSvg(label, value, color, s))
}

const site = computed(() => (plugin.value.catalogUrl ?? `https://plugins.nginxui.com/plugins/${plugin.value.id}/`).replace(/\/plugins\/.*$/, ''))
const page = computed(() => plugin.value.catalogUrl ?? `${site.value}/plugins/${plugin.value.id}/`)
function url(kind: BadgeKind) {
  const base = `${site.value}/badge/${plugin.value.id}${locale.value === 'en' ? '' : `/${locale.value}`}`
  return `${base}/${kind}${style.value ? `.${style.value}` : ''}.svg`
}

const snippet = computed(() => picked.value.map((kind) => {
  const alt = badgeContent(source.value, kind, locale.value).label
  return format.value === 'markdown'
    ? `[![${alt}](${url(kind)})](${page.value})`
    : `<a href="${page.value}"><img src="${url(kind)}" alt="${alt}"></a>`
}).join('\n'))

const { copy, copied } = useClipboard({ legacy: true })
// What the version badge says once the newest version is yanked.
const yankedSample = computed(() => {
  const t = BADGE_STRINGS[locale.value] ?? BADGE_STRINGS.en
  return badgeDataUrl(badgeSvg(t.version, `v${detail.value.releases[0]?.version ?? '1.0.0'} ${t.yanked}`, '#cf1322', style.value))
})
</script>

<template>
  <div class="cols">
    <AFlex vertical gap="middle" class="col-main">
      <ACard :title="$gettext('Badges')" :styles="{ body: { padding: 0 } }">
        <template #extra>
          <AFlex gap="small" align="center" wrap>
            <ASegmented v-model:value="style" :options="[{ value: '', label: $gettext('Rounded') }, { value: 'square', label: $gettext('Square') }, { value: 'large', label: $gettext('Large') }]" />
            <ASelect v-model:value="locale" class="w-36" :options="BADGE_LOCALES.map(l => ({ value: l, label: localeName(l) }))" :aria-label="$gettext('Badge language')" />
          </AFlex>
        </template>
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th class="w-16 whitespace-nowrap">
                  {{ $gettext('Use') }}
                </th>
                <th>{{ $gettext('Shows') }}</th>
                <th>English</th>
                <th v-if="locale !== 'en'">
                  {{ localeName(locale) }}
                </th>
                <th>{{ $gettext('File') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="kind in BADGE_KINDS" :key="kind">
                <td>
                  <ACheckbox :checked="picked.includes(kind)" :aria-label="KIND_LABELS[kind]" @change="(e: { target: { checked: boolean } }) => togglePick(kind, e.target.checked)" />
                </td>
                <td>{{ KIND_LABELS[kind] }}</td>
                <td><img :src="image(kind, 'en')" :alt="KIND_LABELS[kind]"></td>
                <td v-if="locale !== 'en'">
                  <img :src="image(kind, locale)" :alt="KIND_LABELS[kind]">
                </td>
                <td class="mono text-3 op-65">
                  {{ kind }}{{ style ? `.${style}` : '' }}.svg
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ACard>

      <ACard :title="$gettext('Preview')">
        <template #extra>
          <ASegmented v-model:value="theme" size="small" :options="[{ value: 'light', label: $gettext('Light') }, { value: 'dark', label: $gettext('Dark') }]" />
        </template>
        <div class="readme" :class="theme">
          <div class="readme-title">
            {{ plugin.repo?.split('/')[1] ?? plugin.id }}
          </div>
          <AFlex gap="6" wrap>
            <img v-for="kind in picked" :key="kind" :src="image(kind, locale)" :alt="KIND_LABELS[kind]">
          </AFlex>
          <p class="readme-text">
            {{ localized(plugin.description) }}
          </p>
        </div>
      </ACard>

      <ACard :title="$gettext('Code')">
        <template #extra>
          <ASegmented v-model:value="format" size="small" :options="[{ value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' }]" />
        </template>
        <pre class="code">{{ snippet }}</pre>
        <AFlex align="center" gap="middle" class="mt-3" wrap>
          <AButton type="primary" :disabled="!picked.length" @click="copy(snippet)">
            <span :class="copied ? 'i-tabler-check' : 'i-tabler-copy'" />
            {{ copied ? $gettext('Copied') : $gettext('Copy') }}
          </AButton>
          <span class="text-3 op-65">{{ $gettext('Each badge opens the page of the plugin in the catalog.') }}</span>
        </AFlex>
      </ACard>
    </AFlex>

    <AFlex vertical gap="middle" class="col-side">
      <ACard :title="$gettext('About badges')">
        <AFlex vertical gap="10" class="text-3">
          <span><span class="i-tabler-refresh c-info" /> {{ $gettext('Badges change with the catalog: a new release or new translations show at its next update.') }}</span>
          <span><span class="i-tabler-world c-info" /> {{ $gettext('The badge text comes in every language of the catalog site.') }}</span>
          <span><span class="i-tabler-shield c-info" /> {{ $gettext('The catalog serves them with no sign in, and records no visitor.') }}</span>
        </AFlex>
      </ACard>
      <ACard :title="$gettext('Yanked versions')">
        <img :src="yankedSample" :alt="$gettext('Yanked version badge')">
        <ATypographyParagraph type="secondary" class="text-3 mt-2 mb-0">
          {{ $gettext('When the newest version is yanked, the version badge says so, so visitors of the repository know.') }}
        </ATypographyParagraph>
      </ACard>
    </AFlex>
  </div>
</template>

<style scoped>
.table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: 13px;
}

.table th {
  text-align: start;
  font-weight: 500;
  padding: 10px 16px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
}

.table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: middle;
}

.table img {
  display: block;
}

.readme {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  background: #fff;
  color: #1f2328;
}

.readme.dark {
  border-color: #30363d;
  background: #0d1117;
  color: #e6edf3;
}

.readme-title {
  font-size: 22px;
  font-weight: 600;
  padding-bottom: 8px;
  border-bottom: 1px solid #d8dee4;
}

.readme.dark .readme-title {
  border-color: #21262d;
}

.readme-text {
  margin: 0;
  font-size: 14px;
  opacity: 0.8;
}

.code {
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  background: var(--portal-faint);
  border: 1px solid var(--portal-border);
  font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
}

.c-info {
  color: var(--portal-primary);
}
</style>
