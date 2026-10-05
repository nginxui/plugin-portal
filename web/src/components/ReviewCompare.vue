<script setup lang="ts">
import type { PreviewDoc, PreviewManifest } from './MarketPreview.vue'
import { computed, ref } from 'vue'
import { imageChanged } from '@/lib/crop'
import { $gettext, $ngettext } from '@/lib/gettext'
import { joinList, joinSentences } from '@/lib/labels'

// What users will see before and after a change, side by side, as an overlay
// with a slider, or with the changed parts only (spec 11.5).

const props = defineProps<{
  before: PreviewDoc | null
  after: PreviewDoc
  manifest: PreviewManifest | null
  version: string | null
  author: string | null
  trust: string | null
  categories: string[]
  iconUrl: string | null
  locale: string
  theme: 'light' | 'dark'
  images: Record<string, string | null>
}>()

const mode = defineModel<'side' | 'slider' | 'changes'>('mode', { default: 'side' })
const position = ref(50)

const nameChanged = computed(() => JSON.stringify(props.before?.name ?? {}) !== JSON.stringify(props.after.name ?? {}))

// What users see change, each screenshot by its place in the new listing.
const changes = computed(() => {
  const out: string[] = []
  const b = props.before ?? {}
  const a = props.after
  if (nameChanged.value)
    out.push($gettext('Name'))
  if (JSON.stringify(b.description ?? {}) !== JSON.stringify(a.description ?? {}))
    out.push($gettext('Description'))
  if ((b.homepage_url ?? '') !== (a.homepage_url ?? ''))
    out.push($gettext('Homepage'))
  const old = new Map((b.screenshots ?? []).map(s => [s.id, s]))
  ;(a.screenshots ?? []).forEach((shot, i) => {
    const was = old.get(shot.id)
    if (!was || imageChanged(was, shot))
      out.push($gettext('Screenshot %{n}', { n: String(i + 1) }))
  })
  const kept = new Set((a.screenshots ?? []).map(s => s.id))
  if ((b.screenshots ?? []).some(s => !kept.has(s.id)))
    out.push($gettext('Screenshots removed'))
  return out
})

const summary = computed(() => {
  if (!changes.value.length)
    return $gettext('Nothing users see changes.')
  const parts = [$ngettext('%{n} change: %{list}.', '%{n} changes: %{list}.', changes.value.length, { n: String(changes.value.length), list: joinList(changes.value) })]
  if (nameChanged.value && changes.value.length > 1)
    parts.push($gettext('Only the names need review this time, the other changes are for reference.'))
  if (mode.value === 'side' && props.before)
    parts.push($gettext('Switch to the slider to overlay the same spot.'))
  return joinSentences(parts)
})

// The parts that changed only, with everything else dropped.
const onlyChanged = computed<PreviewDoc>(() => {
  const b = props.before ?? {}
  const a = props.after
  return {
    name: a.name,
    ...(JSON.stringify(b.description ?? {}) !== JSON.stringify(a.description ?? {}) ? { description: a.description } : {}),
    ...((b.homepage_url ?? '') !== (a.homepage_url ?? '') ? { homepage_url: a.homepage_url } : {}),
    ...(JSON.stringify(b.screenshots ?? []) !== JSON.stringify(a.screenshots ?? []) ? { screenshots: a.screenshots } : {}),
  }
})

// The parts of the new listing that changed, marked in its preview.
const highlight = computed<Record<string, string>>(() => {
  const b = props.before
  if (!b)
    return {}
  const a = props.after
  const out: Record<string, string> = {}
  if (JSON.stringify(b.name ?? {}) !== JSON.stringify(a.name ?? {}))
    out.name = $gettext('Name')
  if (JSON.stringify(b.description ?? {}) !== JSON.stringify(a.description ?? {}))
    out.description = $gettext('Description')
  if ((b.homepage_url ?? '') !== (a.homepage_url ?? ''))
    out.homepage_url = $gettext('Homepage')
  const old = new Map((b.screenshots ?? []).map(s => [s.id, s]))
  for (const shot of a.screenshots ?? []) {
    const was = old.get(shot.id)
    if (!was)
      out[`shot:${shot.id}`] = $gettext('New screenshot')
    else if (imageChanged(was, shot))
      out[`shot:${shot.id}`] = $gettext('Screenshot image changed')
  }
  return out
})

const common = computed(() => ({
  manifest: props.manifest,
  version: props.version,
  author: props.author,
  trust: props.trust,
  categories: props.categories,
  iconUrl: props.iconUrl,
  locale: props.locale,
  theme: props.theme,
  images: props.images,
}))
</script>

<template>
  <div>
    <div v-if="mode === 'side'" class="pair">
      <div class="side">
        <span class="label">{{ before ? $gettext('Now') : $gettext('Not listed yet') }}</span>
        <MarketPreview v-if="before" v-bind="common" :doc="before" />
        <div v-else class="empty">
          {{ $gettext('A new listing has nothing to compare with.') }}
        </div>
      </div>
      <div class="side after">
        <span class="label">{{ $gettext('After the change') }}</span>
        <MarketPreview v-bind="common" :doc="after" :highlight="highlight" />
      </div>
    </div>

    <div v-else-if="mode === 'slider'" class="overlay">
      <div class="layer">
        <MarketPreview v-bind="common" :doc="before ?? after" />
      </div>
      <div class="layer top" :style="{ clipPath: `inset(0 0 0 ${position}%)` }">
        <MarketPreview v-bind="common" :doc="after" />
      </div>
      <div class="handle" :style="{ left: `${position}%` }" aria-hidden="true" />
      <ASlider v-model:value="position" class="slider" :tooltip="{ open: false }" :aria-label="$gettext('Compare')" />
      <div class="slider-labels text-3 op-65">
        <span>{{ $gettext('Now') }}</span><span>{{ $gettext('After the change') }}</span>
      </div>
    </div>

    <div v-else>
      <MarketPreview v-bind="common" :doc="onlyChanged" :highlight="highlight" />
    </div>

    <p class="text-3 op-65 mt-3 mb-0">
      {{ summary }}
    </p>
  </div>
</template>

<style scoped>
.pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}

.side {
  position: relative;
  padding-top: 26px;
}

.side.after :deep(.frame) {
  box-shadow: 0 0 0 2px rgba(250, 173, 20, 0.25);
  border-color: #faad14;
}

.label {
  position: absolute;
  top: 0;
  left: 2px;
  font-size: 12px;
  font-weight: 500;
  opacity: 0.7;
}

.empty {
  display: grid;
  place-items: center;
  height: 200px;
  border: 1px dashed var(--portal-border-strong);
  border-radius: 10px;
  font-size: 13px;
  opacity: 0.65;
}

.overlay {
  position: relative;
  display: grid;
}

.layer {
  grid-area: 1 / 1;
}

.handle {
  position: absolute;
  top: 0;
  bottom: 52px;
  width: 2px;
  margin-left: -1px;
  background: var(--portal-primary);
  pointer-events: none;
}

.slider {
  grid-area: 2 / 1;
  margin-top: 12px;
}

.slider-labels {
  grid-area: 3 / 1;
  display: flex;
  justify-content: space-between;
}
</style>
