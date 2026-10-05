<script setup lang="ts">
import type { MarketEntry } from '@nginxui/plugin-market-ui'
import type { Crop } from '@/lib/crop'
import type { Localized } from '@/lib/market'
import { bundledText, MarketDetail, provideMarketText } from '@nginxui/plugin-market-ui'
import { theme as antTheme } from 'antdv-next'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { $gettext } from '@/lib/gettext'
import { RTL_LOCALES } from '@/lib/hostLocales'
import { installLabel, renderMarkdown, resolve } from '@/lib/market'

// The marketplace detail of a plugin as Nginx UI shows it, in any language,
// theme and width, with the store texts editable in place. The detail is
// the one Nginx UI draws, from the package both share; this adds the title
// of its drawer and the editors.

export interface PreviewDoc {
  name?: Localized
  description?: Localized
  homepage_url?: string
  screenshots?: { id: string, path: string, crop?: Crop, dark_path?: string, dark_crop?: Crop, caption?: Localized }[]
  // Translations of the permission notes, keyed by permission.
  permission_reasons?: Record<string, Localized>
}

export interface PreviewManifest {
  version?: string
  min_nginx_ui_version?: string
  capabilities?: string[]
  permissions?: string[]
  network_hosts?: string[]
  permission_reasons?: Record<string, string>
  i18n?: Record<string, { permission_reasons?: Record<string, string> }>
}

const props = withDefaults(defineProps<{
  doc: PreviewDoc
  pluginId?: string | null
  locale: string
  theme?: 'light' | 'dark'
  device?: 'desktop' | 'phone'
  images?: Record<string, string | null>
  manifest?: PreviewManifest | null
  version?: string | null
  author?: string | null
  trust?: string | null
  categories?: string[]
  repository?: string | null
  iconUrl?: string | null
  readme?: string | null
  readmeBase?: string | null
  readmeNote?: string
  editable?: boolean
  readmeEditable?: boolean
  // Outline texts that fall back to English in the preview language.
  outline?: boolean
  // Fields an author cannot change here, with why.
  locked?: Record<string, string>
  draft?: ((key: string, locale: string) => Promise<string>) | null
  // How far the preview language is translated, shown while editing.
  progress?: string
  // Unconfirmed AI drafts, as key.locale.
  aiKeys?: string[]
  // Parts to mark as changed, by key ("name", "shot:<id>") with a label.
  highlight?: Record<string, string>
}>(), {
  pluginId: null,
  theme: 'light',
  device: 'desktop',
  images: () => ({}),
  manifest: null,
  version: null,
  author: null,
  trust: null,
  categories: () => [],
  repository: null,
  iconUrl: null,
  readme: null,
  readmeBase: null,
  readmeNote: '',
  editable: false,
  readmeEditable: false,
  outline: false,
  locked: () => ({}),
  draft: null,
  progress: '',
  aiKeys: () => [],
  highlight: () => ({}),
})

const emit = defineEmits<{
  change: [key: string, locale: string, value: string, drafted: boolean]
  next: [key: string]
  readme: [value: string]
  studio: []
  categories: []
}>()

const LIMITS: Record<string, number> = { name: 64, description: 1000, homepage_url: 500, caption: 200, readme: 65536 }

const rtl = computed(() => RTL_LOCALES.includes(props.locale))
const name = computed(() => resolve(props.doc.name, props.locale))
const description = computed(() => resolve(props.doc.description, props.locale))

// The wording of Nginx UI in the preview language, its theme apart from the portal's.
const text = computed(() => bundledText(props.locale))
provideMarketText((msgid, params) => text.value(msgid, params))
const themeConfig = computed(() => ({ algorithm: props.theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm }))

// The store document as the catalog lists it.
const entry = computed<MarketEntry>(() => ({
  id: props.pluginId ?? '',
  name: props.doc.name,
  description: props.doc.description,
  author: props.author ?? undefined,
  homepage_url: props.doc.homepage_url,
  repository_url: props.repository ?? undefined,
  icon_url: props.iconUrl ?? undefined,
  trust: props.trust ?? undefined,
  categories: props.categories,
  capabilities: props.manifest?.capabilities,
  permission_reasons: props.doc.permission_reasons,
  screenshots: (props.doc.screenshots ?? []).map(shot => ({
    id: shot.id,
    url: props.images[shot.path] ?? '',
    dark_url: shot.dark_path ? props.images[shot.dark_path] ?? undefined : undefined,
    caption: shot.caption,
    crop: shot.crop,
    dark_crop: shot.dark_crop,
  })),
  installable_release: props.manifest ? { version: props.version ?? props.manifest.version ?? '', manifest: props.manifest } : undefined,
}))

// Changed parts, by the parts of the detail.
const marks = computed(() => {
  const out: Record<string, string> = {}
  for (const [key, label] of Object.entries(props.highlight)) {
    if (key === 'homepage_url')
      out.links = label
    else if (key !== 'name')
      out[key] = label
  }
  return out
})

const readmeHtml = computed(() => renderMarkdown(props.readme, props.readmeBase))

// Editing in place.
const editing = ref<{ key: string, value: string, original: string, source: string, drafted: boolean } | null>(null)
const drafting = ref(false)
const field = useTemplateRef<{ focus: () => void }>('field')

function valueOf(key: string): { own: string, source: string } {
  const pick = (v: Localized | undefined) => ({ own: v?.[props.locale] ?? '', source: v?.en ?? '' })
  if (key === 'name')
    return pick(props.doc.name)
  if (key === 'description')
    return pick(props.doc.description)
  if (key === 'homepage_url')
    return { own: props.doc.homepage_url ?? '', source: '' }
  if (key === 'readme')
    return { own: props.readme ?? '', source: '' }
  if (key.startsWith('caption:'))
    return pick(props.doc.screenshots?.find(sh => sh.id === key.slice(8))?.caption)
  return { own: '', source: '' }
}

async function edit(key: string) {
  if (!props.editable || props.locked[key] || (key === 'readme' && !props.readmeEditable))
    return
  // A text typed in another field is kept, not dropped.
  if (editing.value && editing.value.key !== key && editing.value.value.trim() !== editing.value.original.trim())
    done()
  const { own, source } = valueOf(key)
  editing.value = { key, value: own, original: own, source: props.locale === 'en' || key === 'homepage_url' || key === 'readme' ? '' : source, drafted: props.aiKeys.includes(`${key}.${props.locale}`) }
  await nextTick()
  // Inside the screenshot list the ref holds an array.
  const target = field.value as unknown as { focus: () => void } | { focus: () => void }[] | null
  ;(Array.isArray(target) ? target[0] : target)?.focus()
}

function limitOf(key: string) {
  return LIMITS[key.startsWith('caption:') ? 'caption' : key] ?? 200
}

// Done confirms what is in the field, an AI draft included, since the
// author has read it.
function done(next = false) {
  const e = editing.value
  if (!e)
    return
  if (e.key === 'readme')
    emit('readme', e.value)
  else
    emit('change', e.key, props.locale, e.value.trim(), false)
  editing.value = null
  if (next)
    emit('next', e.key)
}

async function aiDraft() {
  const e = editing.value
  if (!e || !props.draft)
    return
  drafting.value = true
  try {
    e.value = await props.draft(e.key, props.locale)
    e.drafted = true
  }
  finally {
    drafting.value = false
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    editing.value = null
  }
  else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    done()
  }
  else if (event.key === 'Tab' && !event.shiftKey && editing.value?.source) {
    event.preventDefault()
    done(true)
  }
}

defineExpose({ edit })

const isEditing = (key: string) => editing.value?.key === key
const canPickCategories = computed(() => props.editable && !props.locked.categories)
function editableClass(key: string, missing = false) {
  return {
    editable: props.editable && !props.locked[key] && (key !== 'readme' || props.readmeEditable),
    missing: props.outline && missing,
    on: isEditing(key),
    hl: !!props.highlight[key],
  }
}
</script>

<template>
  <div class="frame" :class="[theme, device, { outlined: outline && editable }]">
    <div class="chrome">
      <span class="dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{{ $gettext('Nginx UI marketplace, as users see it') }}</span>
    </div>
    <AConfigProvider :theme="themeConfig">
      <AFlex vertical class="drawer" :dir="rtl ? 'rtl' : 'ltr'" :lang="locale.replace('_', '-')">
        <div class="drawer-head">
          <div :class="editableClass('name', name.fallback)" :data-hl="highlight.name" class="name-row" role="button" :tabindex="editable ? 0 : -1" @click="edit('name')" @keydown.enter="edit('name')">
            <h2 class="name">
              {{ name.text || pluginId }}
            </h2>
            <span v-if="editable && !locked.name" class="review-pill"><span class="i-tabler-shield-check" />{{ $gettext('Changes need review') }}</span>
          </div>
          <button type="button" class="install" disabled>
            {{ installLabel(locale) }}
          </button>
        </div>

        <div class="drawer-body">
          <div v-if="isEditing('name')" class="editor name-editor" :class="{ pop: editing!.source }" @keydown="onKey">
            <div v-if="progress && editing!.source" class="progress">
              {{ progress }}
            </div>
            <div v-if="editing!.source" class="source">
              <span>English</span>{{ editing!.source }}
            </div>
            <input ref="field" v-model="editing!.value" class="input" :maxlength="limitOf('name')" :aria-label="$gettext('Name')">
            <div class="editor-foot">
              <span class="count">{{ editing!.value.length }} / {{ limitOf('name') }}</span>
              <span v-if="editing!.drafted" class="ai-tag">{{ $gettext('AI draft') }}</span>
              <span class="flex-1" />
              <button v-if="draft && editing!.source" type="button" class="btn" :disabled="drafting" @click="aiDraft">
                <span class="i-tabler-sparkles" />{{ $gettext('AI draft') }}
              </button>
              <button type="button" class="btn" @click="editing = null">
                {{ $gettext('Cancel') }}
              </button>
              <button type="button" class="btn primary" @click="done(!!editing!.source)">
                {{ editing!.source ? $gettext('Save and go to the next') : $gettext('Done') }}
              </button>
            </div>
          </div>

          <MarketDetail :entry="entry" :locale="locale" :dark="theme === 'dark'" :readme-html="readmeHtml" :marks="marks">
            <template #description>
              <p v-if="!isEditing('description') || editing!.source" :class="editableClass('description', description.fallback)" class="pmu-description" role="button" :tabindex="editable ? 0 : -1" @click="edit('description')" @keydown.enter="edit('description')">
                {{ description.text || (editable ? $gettext('Add a description') : text('No description provided.')) }}
              </p>
              <div v-if="isEditing('description')" class="editor" :class="{ pop: editing!.source }" @keydown="onKey">
                <div v-if="progress && editing!.source" class="progress">
                  {{ progress }}
                </div>
                <div v-if="editing!.source" class="source">
                  <span>English</span>{{ editing!.source }}
                </div>
                <textarea ref="field" v-model="editing!.value" class="input" rows="4" :maxlength="limitOf('description')" :aria-label="$gettext('Description')" />
                <div class="editor-foot">
                  <span class="count">{{ editing!.value.length }} / {{ limitOf('description') }}</span>
                  <span v-if="editing!.drafted" class="ai-tag">{{ $gettext('AI draft') }}</span>
                  <span class="flex-1" />
                  <button v-if="draft && editing!.source" type="button" class="btn" :disabled="drafting" @click="aiDraft">
                    <span class="i-tabler-sparkles" />{{ $gettext('AI draft') }}
                  </button>
                  <button type="button" class="btn" @click="editing = null">
                    {{ $gettext('Cancel') }}
                  </button>
                  <button type="button" class="btn primary" @click="done(!!editing!.source)">
                    {{ editing!.source ? $gettext('Save and go to the next') : $gettext('Done') }}
                  </button>
                </div>
              </div>
            </template>

            <template v-if="canPickCategories" #categories="{ labels }">
              <span class="pmu-pill-row editable" role="button" tabindex="0" @click="emit('categories')" @keydown.enter="emit('categories')">
                <span v-for="item in labels" :key="item" class="pmu-pill">{{ item }}</span>
                <span v-if="!labels.length" class="pmu-pill">{{ $gettext('Pick categories') }}</span>
              </span>
            </template>

            <template v-if="editable" #links="{ links }">
              <span v-if="!isEditing('homepage_url')" class="pmu-pill-row">
                <span :class="editableClass('homepage_url')" class="pmu-pill is-link" role="button" tabindex="0" @click="edit('homepage_url')" @keydown.enter="edit('homepage_url')">
                  <span class="i-tabler-world" />{{ doc.homepage_url ? text('Homepage') : $gettext('Add a homepage') }}
                </span>
                <span v-for="link in links.filter(l => l.key !== 'homepage')" :key="link.key" class="pmu-pill is-link">
                  <span class="i-tabler-link" />{{ link.label }}
                </span>
              </span>
              <div v-else class="editor" @keydown="onKey">
                <input ref="field" v-model="editing!.value" class="input" placeholder="https://" :aria-label="$gettext('Homepage')">
                <div class="editor-foot">
                  <span class="flex-1" />
                  <button type="button" class="btn" @click="editing = null">
                    {{ $gettext('Cancel') }}
                  </button>
                  <button type="button" class="btn primary" @click="done()">
                    {{ $gettext('Done') }}
                  </button>
                </div>
              </div>
            </template>

            <template v-if="editable" #screenshots-action>
              <button v-if="!locked.screenshots" type="button" class="edit-pill" @click="emit('studio')">
                <span class="i-tabler-photo-edit" />{{ $gettext('Edit in the screenshot studio') }}
              </button>
            </template>

            <template #missing="{ index }">
              {{ doc.screenshots?.[index]?.path }}
            </template>

            <template #caption="{ index, caption }">
              <figcaption v-if="caption || editable" :class="editableClass(`caption:${doc.screenshots?.[index]?.id}`, !!doc.screenshots?.[index] && resolve(doc.screenshots[index].caption, locale).fallback)" class="pmu-caption" role="button" :tabindex="editable ? 0 : -1" @click="edit(`caption:${doc.screenshots?.[index]?.id}`)" @keydown.enter="edit(`caption:${doc.screenshots?.[index]?.id}`)">
                {{ caption || $gettext('Add a caption') }}
              </figcaption>
            </template>

            <template #screenshots-after>
              <div v-if="editing?.key.startsWith('caption:')" class="editor" :class="{ pop: editing.source }" @keydown="onKey">
                <div v-if="progress && editing.source" class="progress">
                  {{ progress }}
                </div>
                <div v-if="editing.source" class="source">
                  <span>English</span>{{ editing.source }}
                </div>
                <input ref="field" v-model="editing.value" class="input" :maxlength="limitOf('caption')" :aria-label="$gettext('Caption')">
                <div class="editor-foot">
                  <span class="count">{{ editing.value.length }} / {{ limitOf('caption') }}</span>
                  <span v-if="editing.drafted" class="ai-tag">{{ $gettext('AI draft') }}</span>
                  <span class="flex-1" />
                  <button v-if="draft && editing.source" type="button" class="btn" :disabled="drafting" @click="aiDraft">
                    <span class="i-tabler-sparkles" />{{ $gettext('AI draft') }}
                  </button>
                  <button type="button" class="btn" @click="editing = null">
                    {{ $gettext('Cancel') }}
                  </button>
                  <button type="button" class="btn primary" @click="done(!!editing.source)">
                    {{ editing.source ? $gettext('Save and go to the next') : $gettext('Done') }}
                  </button>
                </div>
              </div>
            </template>

            <template v-if="readmeNote" #readme-action>
              <span class="muted small">{{ readmeNote }}</span>
            </template>

            <template v-if="readmeEditable" #readme>
              <div v-if="!isEditing('readme')" :class="editableClass('readme')" class="readme" role="button" tabindex="0" @click="edit('readme')" @keydown.enter="edit('readme')">
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div v-if="readmeHtml" class="pmu-readme" v-html="readmeHtml" />
                <p v-else class="muted">
                  {{ $gettext('Add a README') }}
                </p>
              </div>
              <div v-else class="editor" @keydown="onKey">
                <textarea ref="field" v-model="editing!.value" class="input mono" rows="14" :aria-label="$gettext('README')" />
                <div class="editor-foot">
                  <span class="count">Markdown</span>
                  <span class="flex-1" />
                  <button type="button" class="btn" @click="editing = null">
                    {{ $gettext('Cancel') }}
                  </button>
                  <button type="button" class="btn primary" @click="done()">
                    {{ $gettext('Done') }}
                  </button>
                </div>
              </div>
            </template>
          </MarketDetail>
        </div>
      </AFlex>
    </AConfigProvider>
  </div>
</template>

<style scoped>
.frame {
  --p-bg: #ffffff;
  --p-text: rgba(0, 0, 0, 0.88);
  --p-muted: rgba(0, 0, 0, 0.55);
  --p-fill: rgba(0, 0, 0, 0.04);
  --p-fill-strong: rgba(0, 0, 0, 0.06);
  --p-border: rgba(5, 5, 5, 0.08);
  --p-accent: #1677ff;
  --p-accent-bg: #e6f4ff;
  --p-warn: #d48806;
  border: 1px solid var(--portal-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--p-bg);
  color: var(--p-text);
}

.frame.dark {
  --p-bg: #141414;
  --p-text: rgba(255, 255, 255, 0.85);
  --p-muted: rgba(255, 255, 255, 0.5);
  --p-fill: rgba(255, 255, 255, 0.06);
  --p-fill-strong: rgba(255, 255, 255, 0.1);
  --p-border: #303030;
  --p-accent: #1668dc;
  --p-accent-bg: #111a2c;
  --p-warn: #e8b339;
}

/* Inside the drawer the tokens of its own theme take over. */
.drawer {
  --p-bg: var(--ant-color-bg-elevated);
  --p-text: var(--ant-color-text);
  --p-muted: var(--ant-color-text-secondary);
  --p-fill: var(--ant-color-fill-quaternary);
  --p-fill-strong: var(--ant-color-fill-tertiary);
  --p-border: var(--ant-color-border-secondary);
  --p-accent: var(--ant-color-primary);
  --p-accent-bg: var(--ant-color-primary-bg);
  --p-warn: var(--ant-color-warning);
  background: var(--p-bg);
  color: var(--p-text);
  font-size: 14px;
}

.chrome {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--p-muted);
  background: var(--p-fill);
  border-bottom: 1px solid var(--p-border);
}

.dots {
  display: flex;
  gap: 5px;
}

.dots i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--p-fill-strong);
}

/* The title row of the drawer Nginx UI opens. */
.drawer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--ant-color-split);
}

.drawer-body {
  position: relative;
  padding: 24px;
}

.phone .drawer {
  max-width: 390px;
  margin: 0 auto;
  border-inline: 1px dashed var(--p-border);
}

.phone .drawer-head {
  padding: 14px 16px;
}

.phone .drawer-body {
  padding: 18px 16px;
}

.name-row {
  display: inline-flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.review-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  font-size: 11px;
  line-height: 20px;
  border-radius: 10px;
  color: var(--p-accent);
  background: var(--p-accent-bg);
}

.install {
  flex: none;
  padding: 4px 15px;
  border: 0;
  border-radius: 6px;
  background: var(--p-accent);
  color: #fff;
  opacity: 0.6;
  font: inherit;
}

.name-editor {
  margin-bottom: 16px;
}

.edit-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-inline-start: auto;
  padding: 2px 10px;
  border: 1px solid var(--p-border);
  border-radius: 999px;
  background: var(--p-bg);
  color: var(--p-accent);
  font-size: 12px;
  cursor: pointer;
}

.readme {
  padding: 12px 14px;
  border: 1px solid var(--p-border);
  border-radius: 8px;
  overflow-wrap: anywhere;
  max-height: 420px;
  overflow: auto;
}

.muted {
  margin: 0;
  color: var(--p-muted);
}

.small {
  font-size: 12px;
}

.editable {
  cursor: text;
  border-radius: 6px;
  outline: 1px dashed transparent;
  outline-offset: 4px;
  transition: outline-color 0.15s;
}

.editable:hover,
.editable:focus-visible {
  outline-color: var(--p-accent);
}

.missing {
  outline: 1px dashed var(--p-warn);
  outline-offset: 4px;
  border-radius: 6px;
}

.editor {
  padding: 12px;
  border: 1px solid var(--p-accent);
  border-radius: 8px;
  background: var(--p-bg);
  box-shadow: 0 0 0 3px var(--p-accent-bg);
}

/* A translation opens over the page, so the text it translates stays in view. */
.editor.pop {
  position: absolute;
  z-index: 5;
  width: min(460px, 100%);
  box-sizing: border-box;
  margin-top: 8px;
  border-color: var(--p-border);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12), 0 3px 6px -4px rgba(0, 0, 0, 0.12);
}

.hl {
  position: relative;
  border-radius: 6px;
  outline: 2px solid #faad14;
  outline-offset: 4px;
}

.hl::after {
  content: attr(data-hl);
  position: absolute;
  top: -14px;
  inset-inline-end: 0;
  padding: 0 6px;
  border-radius: 8px;
  background: #faad14;
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
}

.editable.on {
  outline: 2px solid var(--p-accent);
  outline-offset: 4px;
}

.frame.outlined .editable:not(:hover, :focus-visible, .on, .missing) {
  outline-color: var(--p-border);
}

.source {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--p-muted);
}

.source span {
  display: inline-block;
  margin-inline-end: 6px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--p-fill-strong);
}

.input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--p-border);
  border-radius: 6px;
  background: var(--p-bg);
  color: var(--p-text);
  font: inherit;
  resize: vertical;
}

.input:focus {
  outline: 2px solid var(--p-accent-bg);
  border-color: var(--p-accent);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.editor-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.count {
  font-size: 12px;
  color: var(--p-muted);
}

.progress {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--p-muted);
  text-align: end;
}

.ai-tag {
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 18px;
  color: #722ed1;
  background: #f9f0ff;
}

.dark .ai-tag {
  color: #b37feb;
  background: #1a1325;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border: 1px solid var(--p-border);
  border-radius: 6px;
  background: var(--p-bg);
  color: var(--p-text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.btn.primary {
  border-color: var(--p-accent);
  background: var(--p-accent);
  color: #fff;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
