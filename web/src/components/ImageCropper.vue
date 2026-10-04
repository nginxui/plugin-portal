<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { $gettext } from '@/lib/gettext'

// Crops an image to 16:10 with zoom and drag, and encodes it as WebP at a
// width the catalog accepts.
const props = defineProps<{ src: string }>()

const RATIO = 1.6
const MAX_WIDTH = 1920
const MIN_WIDTH = 640

const image = ref<HTMLImageElement | null>(null)
const failed = ref(false)
const zoom = ref(1)
// Offset of the crop centre from the image centre, in image pixels.
const offset = ref({ x: 0, y: 0 })
const frame = ref<HTMLElement | null>(null)

watch(() => props.src, (src) => {
  failed.value = false
  zoom.value = 1
  offset.value = { x: 0, y: 0 }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => (image.value = img)
  img.onerror = () => (failed.value = true)
  img.src = src
}, { immediate: true })

// The largest 16:10 region at zoom 1, then smaller as the zoom grows.
const region = computed(() => {
  const img = image.value
  if (!img)
    return null
  const fit = Math.min(img.naturalWidth, img.naturalHeight * RATIO)
  const width = fit / zoom.value
  const height = width / RATIO
  const maxX = (img.naturalWidth - width) / 2
  const maxY = (img.naturalHeight - height) / 2
  const x = Math.max(-maxX, Math.min(maxX, offset.value.x))
  const y = Math.max(-maxY, Math.min(maxY, offset.value.y))
  return { left: img.naturalWidth / 2 + x - width / 2, top: img.naturalHeight / 2 + y - height / 2, width, height }
})

const style = computed(() => {
  const img = image.value
  const r = region.value
  if (!img || !r)
    return {}
  const scale = 100 / r.width
  return {
    width: `${img.naturalWidth * scale}%`,
    left: `${-r.left * scale}%`,
    top: `${-r.top * scale * RATIO}%`,
  }
})

let drag: { x: number, y: number, start: { x: number, y: number } } | null = null

function onDown(e: PointerEvent) {
  drag = { x: e.clientX, y: e.clientY, start: { ...offset.value } }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent) {
  if (!drag || !region.value || !frame.value)
    return
  const perPixel = region.value.width / frame.value.clientWidth
  offset.value = { x: drag.start.x - (e.clientX - drag.x) * perPixel, y: drag.start.y - (e.clientY - drag.y) * perPixel }
}

function onUp() {
  drag = null
}

onBeforeUnmount(onUp)

const tooSmall = computed(() => !!region.value && region.value.width < MIN_WIDTH)

/** The crop as WebP, or null when the image cannot be read. */
async function crop(): Promise<Blob | null> {
  const img = image.value
  const r = region.value
  if (!img || !r)
    return null
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(r.width / 8) * 8))
  const height = Math.round(width / RATIO)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.imageSmoothingQuality = 'high'
  context.drawImage(img, r.left, r.top, r.width, r.height, 0, 0, width, height)
  for (const quality of [0.9, 0.8, 0.7, 0.6]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
    if (blob && blob.size <= 2 * 1024 * 1024)
      return blob
  }
  return null
}

defineExpose({ crop })
</script>

<template>
  <div class="cropper">
    <div ref="frame" class="frame" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <img v-if="image" :src="src" alt="" class="img" :style="style" draggable="false">
      <div v-else-if="failed" class="msg">
        {{ $gettext('The image could not be read.') }}
      </div>
      <div class="corners" aria-hidden="true">
        <i /><i /><i /><i />
      </div>
    </div>
    <AFlex align="center" gap="middle" class="mt-3">
      <span class="text-3 op-65 nowrap">{{ $gettext('Zoom') }}</span>
      <ASlider v-model:value="zoom" class="flex-1" :min="1" :max="4" :step="0.01" :tooltip="{ open: false }" :aria-label="$gettext('Zoom')" />
    </AFlex>
    <AAlert v-if="tooSmall" type="warning" show-icon class="mt-2" :title="$gettext('The crop is smaller than 640 pixels wide and will look blurred.')" />
  </div>
</template>

<style scoped>
.frame {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 8px;
  background: repeating-conic-gradient(var(--portal-faint) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
  box-shadow: inset 0 0 0 1px var(--portal-border-strong);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.frame:active {
  cursor: grabbing;
}

.img {
  position: absolute;
  max-width: none;
  pointer-events: none;
}

.msg {
  display: grid;
  place-items: center;
  height: 100%;
  opacity: 0.6;
}

.corners i {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid var(--portal-primary);
}

.corners i:nth-child(1) {
  left: 6px;
  top: 6px;
  border-right: 0;
  border-bottom: 0;
}

.corners i:nth-child(2) {
  right: 6px;
  top: 6px;
  border-left: 0;
  border-bottom: 0;
}

.corners i:nth-child(3) {
  left: 6px;
  bottom: 6px;
  border-right: 0;
  border-top: 0;
}

.corners i:nth-child(4) {
  right: 6px;
  bottom: 6px;
  border-left: 0;
  border-top: 0;
}

.nowrap {
  white-space: nowrap;
}
</style>
