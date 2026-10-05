<script setup lang="ts">
import type { Crop } from '@/lib/crop'
import type { Localized } from '@/lib/market'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { cropOf, croppedStyles } from '@/lib/crop'
import { $gettext } from '@/lib/gettext'
import { RTL_LOCALES } from '@/lib/hostLocales'
import { capabilityText, categoryText, installLabel, label, permissionText, renderMarkdown, resolve, trustText } from '@/lib/market'

// The marketplace detail of a plugin as Nginx UI shows it, in any language,
// theme and width, with the store texts editable in place.

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
const L = (key: string, value?: string) => label(props.locale, key, value)

// Screenshots open a larger preview when clicked.
const SHOT = {
  root: { display: 'block', width: '100%' },
  image: { display: 'block', width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--p-border)', background: 'var(--p-fill)' },
} as const

// The image for the theme, framed by its crop; opening it shows it whole.
const shots = computed(() => (props.doc.screenshots ?? []).map((shot) => {
  const darkUrl = props.theme === 'dark' && shot.dark_path ? props.images[shot.dark_path] : null
  return {
    ...shot,
    url: darkUrl ?? props.images[shot.path] ?? null,
    styles: croppedStyles(cropOf(shot, !!darkUrl), SHOT),
    caption: resolve(shot.caption, props.locale),
  }
}))

const permissions = computed(() => (props.manifest?.permissions ?? []).map((p) => {
  const reasons = props.manifest?.i18n?.[props.locale]?.permission_reasons ?? props.manifest?.permission_reasons ?? {}
  return { id: p, ...permissionText(props.locale, p), reason: props.doc.permission_reasons?.[p]?.[props.locale] || reasons[p] || props.manifest?.permission_reasons?.[p] || '' }
}))

const facts = computed(() => {
  const out: { key: string, label: string, value: string }[] = []
  const version = props.version ?? props.manifest?.version
  if (version)
    out.push({ key: 'version', label: L('version'), value: version })
  if (props.manifest?.min_nginx_ui_version)
    out.push({ key: 'requires', label: L('requiresLabel'), value: L('minVersion', props.manifest.min_nginx_ui_version) })
  if (props.author)
    out.push({ key: 'author', label: L('author'), value: props.author })
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
    <div class="body" :dir="rtl ? 'rtl' : 'ltr'" :lang="locale.replace('_', '-')">
      <div class="head">
        <PluginIcon :src="iconUrl" :name="resolve(doc.name, locale).text || '?'" :size="48" />
        <div class="min-w-0 flex-1">
          <div class="pill-row">
            <span v-if="trust" class="pill" :class="trust === 'official' ? 'is-accent' : ''">{{ trustText(locale, trust) }}</span>
            <span v-for="cap in manifest?.capabilities ?? []" :key="cap" class="pill is-accent">{{ capabilityText(locale, cap) }}</span>
          </div>
          <div :class="editableClass('name', name.fallback)" :data-hl="highlight.name" class="name-row" role="button" :tabindex="editable ? 0 : -1" @click="edit('name')" @keydown.enter="edit('name')">
            <h2 class="name">
              {{ name.text }}
            </h2>
            <span v-if="editable && !locked.name" class="review-pill"><span class="i-tabler-shield-check" />{{ $gettext('Changes need review') }}</span>
          </div>
          <div v-if="author" class="by">
            {{ L('by', author) }}
          </div>
        </div>
        <button type="button" class="install" disabled>
          {{ installLabel(locale) }}
        </button>
      </div>

      <div v-if="isEditing('name')" class="editor" :class="{ pop: editing!.source }" @keydown="onKey">
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

      <p v-if="!isEditing('description') || editing!.source" :class="editableClass('description', description.fallback)" :data-hl="highlight.description" class="description" role="button" :tabindex="editable ? 0 : -1" @click="edit('description')" @keydown.enter="edit('description')">
        {{ description.text || (editable ? $gettext('Add a description') : '') }}
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

      <div v-if="facts.length" class="facts">
        <div v-for="fact in facts" :key="fact.key" class="fact">
          <span class="fact-label">{{ fact.label }}</span>
          <span class="fact-value">{{ fact.value }}</span>
        </div>
      </div>

      <dl class="list">
        <div v-if="categories.length" class="row">
          <dt>{{ L('categories') }}</dt>
          <dd class="pill-row" :class="{ editable: canPickCategories }" :role="canPickCategories ? 'button' : undefined" :tabindex="canPickCategories ? 0 : -1" @click="canPickCategories && emit('categories')" @keydown.enter="canPickCategories && emit('categories')">
            <span v-for="item in categories" :key="item" class="pill">{{ categoryText(locale, item) }}</span>
          </dd>
        </div>
        <div v-if="doc.homepage_url || editable" class="row">
          <dt>{{ L('homepage') }}</dt>
          <dd>
            <span v-if="!isEditing('homepage_url')" :class="editableClass('homepage_url')" :data-hl="highlight.homepage_url" class="link" role="button" :tabindex="editable ? 0 : -1" @click="edit('homepage_url')" @keydown.enter="edit('homepage_url')">
              {{ doc.homepage_url || (editable ? $gettext('Add a homepage') : '') }}
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
          </dd>
        </div>
        <div v-if="repository" class="row">
          <dt>{{ L('repository') }}</dt>
          <dd class="link">
            {{ repository.replace('https://', '') }}
          </dd>
        </div>
      </dl>

      <section v-if="shots.length || editable" class="section">
        <div class="section-head">
          <h4>{{ L('screenshots') }}</h4>
          <button v-if="editable && !locked.screenshots" type="button" class="edit-pill" @click="emit('studio')">
            <span class="i-tabler-photo-edit" />{{ $gettext('Edit in the screenshot studio') }}
          </button>
        </div>
        <AImagePreviewGroup>
          <div class="strip">
            <figure v-for="shot in shots" :key="shot.id" class="shot" :class="{ hl: highlight[`shot:${shot.id}`] }" :data-hl="highlight[`shot:${shot.id}`]">
              <AImage v-if="shot.url" :src="shot.url" :alt="shot.caption.text" loading="lazy" referrerpolicy="no-referrer" :styles="shot.styles" />
              <div v-else class="shot-missing">
                {{ shot.path }}
              </div>
              <figcaption :class="editableClass(`caption:${shot.id}`, shot.caption.fallback)" role="button" :tabindex="editable ? 0 : -1" @click="edit(`caption:${shot.id}`)" @keydown.enter="edit(`caption:${shot.id}`)">
                {{ shot.caption.text || (editable ? $gettext('Add a caption') : '') }}
              </figcaption>
            </figure>
          </div>
        </AImagePreviewGroup>
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
      </section>

      <section class="section">
        <div class="section-head">
          <h4>{{ L('permissions') }}</h4>
          <span v-if="permissions.length" class="count-pill">{{ permissions.length }}</span>
        </div>
        <ul v-if="permissions.length" class="permissions">
          <li v-for="p in permissions" :key="p.id">
            <span class="perm-tag">{{ p.label }}</span>
            <div>
              <div class="perm-desc">
                {{ p.description }}
              </div>
              <div v-if="p.id === 'network'" class="perm-reason">
                {{ manifest?.network_hosts?.length ? `${L('onlyHosts')}: ${manifest.network_hosts.join(', ')}` : L('noHosts') }}
              </div>
              <div v-if="p.reason" class="perm-reason">
                <span>{{ L('authorNote') }}</span> {{ p.reason }}
              </div>
            </div>
          </li>
        </ul>
        <p v-else class="muted">
          {{ L('noPermissions') }}
        </p>
      </section>

      <section v-if="readme || readmeEditable" class="section">
        <div class="section-head">
          <h4>README</h4>
          <span v-if="readmeNote" class="muted small">{{ readmeNote }}</span>
        </div>
        <div v-if="!isEditing('readme')" :class="editableClass('readme')" class="readme" role="button" :tabindex="readmeEditable ? 0 : -1" @click="edit('readme')" @keydown.enter="edit('readme')">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="readmeHtml" v-html="readmeHtml" />
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
      </section>
    </div>
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

.body {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 24px;
  font-size: 14px;
}

.phone .body {
  max-width: 390px;
  margin: 0 auto;
  padding: 18px 16px;
  border-inline: 1px dashed var(--p-border);
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 8px;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  font-size: 12px;
  line-height: 20px;
  color: var(--p-muted);
  background: var(--p-fill-strong);
  border-radius: 999px;
}

.pill.is-accent {
  color: var(--p-accent);
  background: var(--p-accent-bg);
}

.name-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  max-width: 100%;
}

.name {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
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

.by {
  margin-top: 2px;
  font-size: 12px;
  color: var(--p-muted);
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

.description {
  margin: 0;
  line-height: 1.7;
  color: var(--p-muted);
  white-space: pre-line;
}

.facts {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: var(--p-fill);
  border-radius: 12px;
  min-width: 0;
}

.fact-label {
  font-size: 12px;
  color: var(--p-muted);
}

.fact-value {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}

.row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
}

.row dt {
  font-size: 12px;
  color: var(--p-muted);
}

.row dd {
  margin: 0;
}

.link {
  color: var(--p-accent);
  overflow-wrap: anywhere;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-head h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.count-pill {
  padding: 0 7px;
  font-size: 12px;
  line-height: 18px;
  border-radius: 999px;
  background: var(--p-fill-strong);
  color: var(--p-muted);
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

.strip {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.shot {
  flex: none;
  width: 240px;
  margin: 0;
}

.phone .shot {
  width: 200px;
}

.shot-missing {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--p-border);
  background: var(--p-fill);
}

.shot-missing {
  display: grid;
  place-items: center;
  padding: 8px;
  font-size: 11px;
  color: var(--p-muted);
  overflow-wrap: anywhere;
}

.shot figcaption {
  margin-top: 6px;
  font-size: 12px;
  color: var(--p-muted);
}

.permissions {
  margin: 0;
  padding: 0;
  list-style: none;
}

.permissions li {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 8px;
  align-items: baseline;
  padding: 6px 0;
}

.permissions li + li {
  border-top: 1px solid var(--p-border);
}

.perm-tag {
  padding: 0 7px;
  font-size: 12px;
  line-height: 20px;
  border-radius: 4px;
  color: var(--p-warn);
  border: 1px solid currentcolor;
}

.perm-desc {
  color: var(--p-muted);
}

.perm-reason {
  margin-top: 6px;
  padding-inline-start: 10px;
  border-inline-start: 2px solid var(--p-border);
  font-size: 13px;
}

.perm-reason span {
  color: var(--p-muted);
}

.readme {
  padding: 12px 14px;
  border: 1px solid var(--p-border);
  border-radius: 8px;
  overflow-wrap: anywhere;
  max-height: 420px;
  overflow: auto;
}

.readme :deep(img) {
  max-width: 100%;
}

.readme :deep(h1) {
  font-size: 18px;
}

.readme :deep(h2) {
  font-size: 16px;
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

.body,
.section {
  position: relative;
}

/* The caption editor opens below the captions of the strip. */
.section > .editor.pop {
  top: calc(100% - 8px);
  inset-inline-start: 0;
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
