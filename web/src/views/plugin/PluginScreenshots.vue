<script setup lang="ts">
import type { StoreState } from '@/api/store'
import type { PreviewDoc } from '@/components/MarketPreview.vue'
import type { Crop } from '@/lib/crop'
import { useLocalStorage } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { aiDraft, aiStatus } from '@/api/community'
import { uploadImage } from '@/api/store'
import { croppedStyles } from '@/lib/crop'
import gettext, { $gettext } from '@/lib/gettext'
import { HOST_LOCALES, RTL_LOCALES } from '@/lib/hostLocales'
import { localeName } from '@/lib/locales'
import { fromNow } from '@/lib/time'
import { useStoreDraft } from '@/lib/useStoreDraft'
import { usePluginStore } from '@/stores/plugin'

type Shot = NonNullable<PreviewDoc['screenshots']>[number]

const pluginStore = usePluginStore()
const plugin = computed(() => pluginStore.detail!.plugin)
const draft = useStoreDraft(() => plugin.value.id)
const { state, failed, doc, items, savedAt, saving } = draft
watch(() => plugin.value.id, draft.load, { immediate: true })

const S = computed(() => state.value as StoreState)
const shots = computed(() => doc.value.screenshots ?? [])
const canEdit = computed(() => !!state.value?.canEdit.all && !('screenshots' in (state.value?.overrides ?? {})))
const imageOf = (path: string | undefined) => path ? (state.value?.images[path] ?? (path.startsWith('media:') ? `/api/media/${path.slice(6)}` : null)) : null

const MAX_SHOTS = 8
const selectedId = ref<string | null>(null)
const selected = computed(() => shots.value.find(s => s.id === selectedId.value) ?? null)
watch(shots, (list) => {
  if (!selectedId.value || !list.some(s => s.id === selectedId.value))
    selectedId.value = list[0]?.id ?? null
}, { immediate: true })

function setShots(list: Shot[]) {
  draft.update({ ...doc.value, screenshots: list.length ? list : undefined })
}

// Reordering by drag.
const dragging = ref<string | null>(null)
function onDrop(target: string) {
  const from = dragging.value
  dragging.value = null
  if (!from || from === target)
    return
  const list = [...shots.value]
  const item = list.splice(list.findIndex(s => s.id === from), 1)[0]
  list.splice(list.findIndex(s => s.id === target), 0, item)
  setShots(list)
}

function move(id: string, step: number) {
  const list = [...shots.value]
  const at = list.findIndex(s => s.id === id)
  const to = at + step
  if (to < 0 || to >= list.length)
    return
  const item = list[at]
  list[at] = list[to]
  list[to] = item
  setShots(list)
}

// Framing a picked file, or the current image again. By default the whole
// image is kept and the document records the part lists show; opening the
// screenshot shows it whole. Otherwise the part becomes an image of its own.
const keepOriginal = useLocalStorage('portal-screenshot-keep-original', true)
interface Framer {
  crop: () => Promise<Blob | null>
  cropOrNull: () => Crop | null
  original: () => Promise<Blob | null>
  reset: () => void
}
const side = ref<'light' | 'dark'>('light')
const pending = ref<{ url: string, target: 'new' | 'light' | 'dark', name: string } | null>(null)
const cropper = useTemplateRef<Framer>('cropper')
const uploading = ref(false)
const uploadError = ref('')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
let fileTarget: 'new' | 'light' | 'dark' = 'new'

function slug(name: string) {
  const base = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/^\d+[-_\s]*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'shot'
  let id = base
  for (let n = 2; shots.value.some(s => s.id === id); n++)
    id = `${base}-${n}`
  return id
}

function pick(target: 'new' | 'light' | 'dark') {
  fileTarget = target
  fileInput.value?.click()
}

function openFile(file: File | undefined, target: 'new' | 'light' | 'dark') {
  uploadError.value = ''
  if (!file)
    return
  if (!/^image\/(?:png|jpeg|webp)$/.test(file.type)) {
    uploadError.value = $gettext('Use a PNG, JPEG or WebP image.')
    return
  }
  if (target === 'new' && shots.value.length >= MAX_SHOTS) {
    uploadError.value = $gettext('A listing holds at most %{n} screenshots.', { n: String(MAX_SHOTS) })
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    uploadError.value = $gettext('The image is larger than 20 MB.')
    return
  }
  if (pending.value)
    URL.revokeObjectURL(pending.value.url)
  pending.value = { url: URL.createObjectURL(file), target, name: file.name }
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  openFile(input.files?.[0], fileTarget)
  input.value = ''
}

const dropping = ref(false)
function onDropFile(e: DragEvent) {
  dropping.value = false
  openFile(e.dataTransfer?.files?.[0], 'new')
}

// The image of the selected screenshot sits in a crop box all the time; a
// crop is encoded and uploaded only when it is confirmed.
const liveUrl = computed(() => imageOf(side.value === 'dark' ? selected.value?.dark_path : selected.value?.path))
const live = useTemplateRef<Framer>('live')
// The crop the live frame starts from: the dark image's, else the light one's.
const liveCrop = computed(() => side.value === 'dark' ? selected.value?.dark_crop ?? selected.value?.crop ?? null : selected.value?.crop ?? null)
const adjusted = ref(false)
const liveFailed = ref(false)
watch(liveUrl, () => {
  adjusted.value = false
  liveFailed.value = false
})

async function applyCrop() {
  const p = pending.value
  if (!p)
    return
  if (await upload(cropper.value, p.target, p.name)) {
    URL.revokeObjectURL(p.url)
    pending.value = null
  }
}

// A shot with the image of one side and its crop, none to show it whole.
function withImage(shot: Shot, target: 'light' | 'dark', path: string | null, crop: Crop | null): Shot {
  const [pathKey, cropKey] = target === 'dark' ? ['dark_path', 'dark_crop'] as const : ['path', 'crop'] as const
  const next: Shot = { ...shot, ...(path ? { [pathKey]: path } : {}) }
  if (crop)
    next[cropKey] = crop
  else
    delete next[cropKey]
  return next
}

// Keeping the whole image, a new frame is only a new crop; otherwise the
// framed part is encoded and uploaded as the image.
async function applyLive() {
  const shot = selected.value
  if (!shot)
    return
  if (keepOriginal.value) {
    setShots(shots.value.map(s => s.id === shot.id ? withImage(s, side.value, null, live.value?.cropOrNull() ?? null) : s))
    adjusted.value = false
    return
  }
  if (await upload(live.value, side.value, shot.id))
    adjusted.value = false
}

async function upload(framer: Framer | null, target: 'new' | 'light' | 'dark', name: string): Promise<boolean> {
  uploading.value = true
  uploadError.value = ''
  try {
    const original = keepOriginal.value
    const blob = framer ? await (original ? framer.original() : framer.crop()) : null
    if (!blob) {
      uploadError.value = $gettext('The image could not be encoded under 2 MB.')
      return false
    }
    const crop = original ? framer?.cropOrNull() ?? null : null
    const { path, url } = await uploadImage(blob, original)
    if (state.value)
      state.value.images[path] = url
    if (target === 'new') {
      const id = slug(name)
      setShots([...shots.value, withImage({ id, path }, 'light', path, crop)])
      selectedId.value = id
      side.value = 'light'
    }
    else if (selected.value) {
      setShots(shots.value.map(s => s.id === selected.value!.id ? withImage(s, target, path, crop) : s))
    }
    return true
  }
  catch (e) {
    const code = (e as Error).message
    uploadError.value = code === 'bad_size' && keepOriginal.value
      ? $gettext('The image is too small: it needs room for a 16:10 part at least 640 pixels wide.')
      : code === 'bad_ratio' || code === 'bad_size'
        ? $gettext('The image was refused: it must be 16:10 and between 640 and 3840 pixels wide.')
        : code === 'uploads_off'
          ? $gettext('Screenshot uploads are not open yet.')
          : $gettext('The image could not be uploaded. Please try again.')
    return false
  }
  finally {
    uploading.value = false
  }
}

function cancelCrop() {
  if (pending.value?.url.startsWith('blob:'))
    URL.revokeObjectURL(pending.value.url)
  pending.value = null
}

onBeforeUnmount(cancelCrop)

function removeDark() {
  if (selected.value)
    setShots(shots.value.map(s => s.id === selected.value!.id ? (({ dark_path: _path, dark_crop: _crop, ...rest }) => rest)(s) : s))
}

function remove() {
  if (selected.value)
    setShots(shots.value.filter(s => s.id !== selected.value!.id))
}

// Captions.
const showAll = ref(false)
const captionLocales = computed(() => {
  const filled = HOST_LOCALES.filter(l => l === 'en' || selected.value?.caption?.[l])
  return showAll.value ? HOST_LOCALES : filled
})
const filledOthers = computed(() => HOST_LOCALES.filter(l => l !== 'en' && selected.value?.caption?.[l]).length)

function setCaption(locale: string, value: string) {
  if (selected.value)
    draft.setText(`caption:${selected.value.id}`, locale, value.trim())
}

// AI drafts of the captions a language lacks.
const ai = ref<{ enabled: boolean, remaining?: number }>({ enabled: false })
aiStatus().then(value => (ai.value = value)).catch(() => {})
const missingCaptions = computed(() => selected.value?.caption?.en ? HOST_LOCALES.filter(l => l !== 'en' && !selected.value?.caption?.[l]) : [])
const drafting = ref<{ done: number, total: number } | null>(null)
const aiError = ref('')
async function draftCaptions() {
  const shot = selected.value
  if (!shot?.caption?.en)
    return
  const todo = [...missingCaptions.value]
  drafting.value = { done: 0, total: todo.length }
  aiError.value = ''
  for (const locale of todo) {
    try {
      const result = await aiDraft(plugin.value.id, `caption:${shot.id}`, locale, shot.caption.en)
      draft.setText(`caption:${shot.id}`, locale, result.text, true)
      ai.value = { ...ai.value, remaining: result.remaining }
      drafting.value.done++
    }
    catch (e) {
      aiError.value = (e as { code?: string }).code === 'quota' ? $gettext('No AI drafts are left for today.') : $gettext('The AI draft could not be made. Please try again later.')
      break
    }
  }
  drafting.value = null
}
const isAiDraft = (id: string, locale: string) => draft.ai.value.includes(`caption:${id}.${locale}`)

// A screenshot is named by its caption in the language of the portal.
const titleOf = (shot: Shot) => shot.caption?.[gettext.current] || shot.caption?.en || shot.id

const complete = (shot: Shot) => !!shot.dark_path
const changedIds = computed(() => new Set(items.value.filter(i => i.field === 'screenshots' || i.field === 'caption').map(i => i.label.split('.')[1])))

// Thumbnails open a larger preview when clicked.
const THUMB = {
  root: { display: 'block', width: '100%' },
  image: { display: 'block', width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--portal-border)', background: 'var(--portal-faint)' },
} as const

// Each thumbnail framed by its crop. Made once per change of the screenshots,
// since a new styles object on every render makes the preview group loop.
const thumbStyles = computed(() => Object.fromEntries(shots.value.map(shot => [shot.id, {
  light: croppedStyles(shot.crop, THUMB),
  dark: croppedStyles(shot.dark_crop ?? shot.crop, THUMB),
}])))
</script>

<template>
  <AFlex vertical gap="middle">
    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The store texts could not be loaded.')" />
    <ASkeleton v-else-if="!state" active />
    <template v-else>
      <AAlert v-if="!S.uploads" type="info" show-icon :title="$gettext('Screenshot uploads are not open yet. You can reorder the screenshots and edit their captions.')" />
      <AAlert v-if="'screenshots' in S.overrides" type="warning" show-icon :title="$gettext('The catalog entry sets the screenshots of this plugin, so they cannot be changed here.')" />

      <div class="cols">
        <ACard class="col-main" :title="$gettext('Screenshots')">
          <template #extra>
            <AFlex align="center" gap="middle">
              <span class="text-3 op-65 extra-hint">{{ $gettext('16:10, light and dark in pairs') }}</span>
              <AButton type="primary" :disabled="!canEdit || !S.uploads || shots.length >= MAX_SHOTS" @click="pick('new')">
                <span class="i-tabler-upload" />
                {{ $gettext('Add a screenshot') }}
              </AButton>
            </AFlex>
          </template>
          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFile">
          <div class="grid">
            <div
              v-for="(shot, i) in shots"
              :key="shot.id"
              class="shot-card"
              :class="{ on: shot.id === selectedId, dragging: dragging === shot.id }"
              :draggable="canEdit"
              role="button"
              tabindex="0"
              :aria-label="$gettext('Screenshot %{n}', { n: String(i + 1) })"
              @click="selectedId = shot.id"
              @keydown.enter="selectedId = shot.id"
              @keydown.alt.up.prevent="move(shot.id, -1)"
              @keydown.alt.down.prevent="move(shot.id, 1)"
              @dragstart="dragging = shot.id"
              @dragend="dragging = null"
              @dragover.prevent
              @drop.prevent="onDrop(shot.id)"
            >
              <AFlex justify="space-between" align="center" gap="small">
                <span class="title truncate"><span class="i-tabler-grip-vertical op-50" />{{ i + 1 }}. {{ titleOf(shot) }}</span>
                <ATag v-if="changedIds.has(shot.id)" color="blue" class="m-0">
                  {{ $gettext('Changed') }}
                </ATag>
                <ATag v-else :color="complete(shot) ? 'success' : 'warning'" class="m-0">
                  {{ complete(shot) ? $gettext('Complete') : $gettext('No dark version') }}
                </ATag>
              </AFlex>
              <AImagePreviewGroup>
                <div class="pair">
                  <AImage v-if="imageOf(shot.path)" :src="imageOf(shot.path)!" alt="" referrerpolicy="no-referrer" :styles="thumbStyles[shot.id]?.light" />
                  <AImage v-if="imageOf(shot.dark_path)" :src="imageOf(shot.dark_path)!" alt="" referrerpolicy="no-referrer" :styles="thumbStyles[shot.id]?.dark" />
                  <div v-else class="missing" :class="{ clickable: canEdit && S.uploads }" @click.stop="canEdit && S.uploads && (selectedId = shot.id, side = 'dark', pick('dark'))">
                    {{ $gettext('No dark screenshot') }}
                    <span v-if="canEdit && S.uploads" class="block text-3">{{ $gettext('Click to upload') }}</span>
                  </div>
                </div>
              </AImagePreviewGroup>
              <div class="text-3 truncate">
                {{ shot.caption?.en || $gettext('No caption') }}
              </div>
            </div>
          </div>
          <div
            v-if="canEdit && S.uploads && shots.length < MAX_SHOTS"
            class="dropzone"
            :class="{ over: dropping }"
            role="button"
            tabindex="0"
            @click="pick('new')"
            @keydown.enter="pick('new')"
            @dragover.prevent="dropping = true"
            @dragleave="dropping = false"
            @drop.prevent="onDropFile"
          >
            <span class="i-tabler-upload text-6 op-50" />
            <div>{{ $gettext('Drop a PNG, JPEG or WebP image here') }}</div>
            <div class="text-3 op-65">
              {{ keepOriginal ? $gettext('Kept whole and converted to WebP, up to 2 MB; lists show the 16:10 part you choose') : $gettext('Cropped to 16:10 and converted to WebP, up to 2 MB') }}
            </div>
          </div>
          <AEmpty v-if="!shots.length && !(canEdit && S.uploads)" :description="$gettext('No screenshots yet.')" />
          <div v-if="savedAt" class="text-3 op-65 mt-3">
            {{ saving ? $gettext('Saving the draft') : $gettext('Draft saved %{time}. Submit it from the store page.', { time: fromNow(savedAt) }) }}
            <RouterLink :to="`/plugins/${plugin.id}`">
              {{ $gettext('Store details') }}
            </RouterLink>
          </div>
        </ACard>

        <AFlex vertical gap="middle" class="col-side">
          <ACard v-if="pending" :title="pending.target === 'new' ? $gettext('New screenshot') : pending.target === 'dark' ? $gettext('Dark version') : $gettext('Light version')">
            <ImageCropper ref="cropper" :src="pending.url" />
            <div class="keep">
              <ACheckbox v-model:checked="keepOriginal">
                {{ $gettext('Keep the whole image, record only the part shown') }}
              </ACheckbox>
              <div class="text-3 op-65">
                {{ keepOriginal ? $gettext('Lists show the framed part; opening the screenshot shows the whole image.') : $gettext('The framed part becomes the image; the rest is not kept.') }}
              </div>
            </div>
            <AAlert v-if="uploadError" type="error" show-icon class="mt-3" :title="uploadError" />
            <AFlex justify="flex-end" gap="small" class="mt-4">
              <AButton @click="cancelCrop">
                {{ $gettext('Cancel') }}
              </AButton>
              <AButton type="primary" :loading="uploading" @click="applyCrop">
                {{ pending.target === 'new' ? $gettext('Add the screenshot') : $gettext('Use this crop') }}
              </AButton>
            </AFlex>
          </ACard>

          <ACard v-else-if="selected" :title="`${shots.indexOf(selected) + 1}. ${titleOf(selected)}`">
            <template #extra>
              <ASegmented v-model:value="side" size="small" :options="[{ value: 'light', label: $gettext('Light') }, { value: 'dark', label: $gettext('Dark') }]" />
            </template>
            <div class="preview">
              <ImageCropper v-if="liveUrl && canEdit && (S.uploads || keepOriginal) && !liveFailed" ref="live" :key="liveUrl" :src="liveUrl" :crop="liveCrop" @adjusted="adjusted = $event" @failed="liveFailed = true" />
              <img v-else-if="liveUrl" :src="liveUrl" alt="" referrerpolicy="no-referrer">
              <div v-else class="missing big" :class="{ clickable: canEdit && S.uploads }" @click="canEdit && S.uploads && pick(side)">
                {{ side === 'dark' ? $gettext('No dark screenshot') : $gettext('The image is missing') }}
                <span v-if="canEdit && S.uploads" class="block text-3">{{ $gettext('Click to upload') }}</span>
              </div>
            </div>
            <AFlex gap="small" wrap class="mt-3">
              <template v-if="adjusted">
                <AButton size="small" type="primary" :loading="uploading" @click="applyLive">
                  {{ keepOriginal ? $gettext('Show this part') : $gettext('Use this crop') }}
                </AButton>
                <AButton size="small" :disabled="uploading" @click="live?.reset()">
                  {{ $gettext('Undo the crop') }}
                </AButton>
              </template>
              <AButton size="small" :disabled="!canEdit || !S.uploads" @click="pick(side)">
                {{ side === 'dark' && !selected.dark_path ? $gettext('Upload the dark version') : $gettext('Replace the image') }}
              </AButton>
              <AButton v-if="side === 'dark' && selected.dark_path" size="small" :disabled="!canEdit" @click="removeDark">
                {{ $gettext('Remove the dark version') }}
              </AButton>
            </AFlex>
            <div v-if="liveUrl && canEdit" class="keep">
              <ACheckbox v-model:checked="keepOriginal">
                {{ $gettext('Keep the whole image, record only the part shown') }}
              </ACheckbox>
              <div class="text-3 op-65">
                {{ keepOriginal ? $gettext('Lists show the framed part; opening the screenshot shows the whole image.') : $gettext('The framed part becomes the image; the rest is not kept.') }}
              </div>
            </div>

            <div class="captions">
              <div class="font-500 mb-2">
                {{ $gettext('Caption') }}
              </div>
              <label v-for="l in captionLocales" :key="l" class="caption">
                <span class="text-3 op-65">{{ localeName(l) }}</span>
                <AInput
                  :value="selected.caption?.[l] ?? ''"
                  :dir="RTL_LOCALES.includes(l) ? 'rtl' : 'auto'"
                  :maxlength="200"
                  :disabled="!S.canEdit.texts"
                  :placeholder="l === 'en' ? '' : selected.caption?.en"
                  @change="(e: Event) => setCaption(l, (e.target as HTMLInputElement).value)"
                />
                <span v-if="isAiDraft(selected.id, l)" class="ai-line"><span class="ai-tag">{{ $gettext('AI draft') }}</span><span class="text-3 op-65">{{ $gettext('Waiting for confirmation') }}</span></span>
              </label>
              <AButton type="link" size="small" class="px-0" @click="showAll = !showAll">
                <span :class="showAll ? 'i-tabler-chevron-up' : 'i-tabler-chevron-down'" />
                {{ showAll ? $gettext('Show filled languages only') : $gettext('The other languages, %{n} of %{total} filled', { n: String(filledOthers), total: String(HOST_LOCALES.length - 1) }) }}
              </AButton>
              <div v-if="ai.enabled && missingCaptions.length">
                <AButton size="small" :loading="!!drafting" :disabled="!S.canEdit.texts" @click="draftCaptions">
                  <span class="i-tabler-sparkles" />
                  {{ drafting ? $gettext('Drafting %{done} of %{total}', { done: String(drafting.done), total: String(drafting.total) }) : $gettext('AI draft the caption in the %{n} missing languages', { n: String(missingCaptions.length) }) }}
                </AButton>
              </div>
              <AAlert v-if="aiError" type="error" show-icon class="mt-2" :title="aiError" />
            </div>
            <APopconfirm :title="$gettext('Delete this screenshot and its captions?')" :ok-text="$gettext('Delete')" :cancel-text="$gettext('Cancel')" :disabled="!canEdit" @confirm="remove">
              <AButton danger class="mt-3" :disabled="!canEdit">
                {{ $gettext('Delete this screenshot') }}
              </AButton>
            </APopconfirm>
          </ACard>
          <AAlert v-if="uploadError && !pending" type="error" show-icon :title="uploadError" />
        </AFlex>
      </div>
    </template>
  </AFlex>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.shot-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--portal-border-strong);
  border-radius: 8px;
  background: var(--portal-card);
  cursor: pointer;
}

.shot-card.on {
  border-color: var(--portal-primary);
  box-shadow: 0 0 0 2px var(--portal-primary-bg);
}

.shot-card.dragging {
  opacity: 0.5;
}

.shot-card:focus-visible {
  outline: 2px solid var(--portal-primary);
}

.title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.missing {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--portal-border);
  background: var(--portal-faint);
}

.missing {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  border: 1px dashed #faad14;
  color: var(--portal-warn-text);
  font-size: 12px;
  text-align: center;
}

.missing.clickable {
  cursor: pointer;
  align-content: center;
  background: var(--portal-warn-bg);
}

.ai-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.ai-tag {
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--portal-ai-text);
  background: var(--portal-ai-bg);
  border: 1px solid var(--portal-ai-border);
}

.missing.big {
  font-size: 13px;
}

.preview img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--portal-border);
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-top: 16px;
  padding: 24px;
  border: 1px dashed var(--portal-border-strong);
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
}

.dropzone.over,
.dropzone:hover {
  border-color: var(--portal-primary);
  background: var(--portal-primary-bg);
}

.captions {
  margin-top: 20px;
}

.keep {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.caption {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
</style>
