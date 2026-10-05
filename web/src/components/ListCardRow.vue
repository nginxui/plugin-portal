<script setup lang="ts">
import type { PreviewDoc } from './MarketPreview.vue'
import type { Stress } from '@/lib/market'
import { nextTick, onMounted, ref, watch } from 'vue'
import { $gettext } from '@/lib/gettext'
import { HOST_LOCALES, RTL_LOCALES } from '@/lib/hostLocales'
import { localeName } from '@/lib/locales'
import { resolve, trustText } from '@/lib/market'

// Marketplace list cards at the width Nginx UI gives them, one per language,
// so a name cut short shows before it is listed. Each card shows its own
// language as users see it, whatever the stress test does to the preview.
const props = defineProps<{ doc: PreviewDoc, locale: string, stress: Stress, trust: string | null, theme: 'light' | 'dark', author?: string | null, iconUrl?: string | null }>()
const emit = defineEmits<{ results: [cut: Record<string, boolean>], estimate: [estimate: Estimate | null] }>()

/** The English name is cut short already, or fits now while a longer language may not. */
export interface Estimate {
  now: boolean
  maxChars: number
}

// Languages such as German or Turkish run about a third longer than English.
const GROWTH = 1.3

const CARD_WIDTH = 320
const names = ref<HTMLElement[]>([])
const cut = ref<Record<string, boolean>>({})
const estimate = ref<Estimate | null>(null)

const locales = () => props.stress === 'off' ? [props.locale] : HOST_LOCALES

function estimateText(e: Estimate): string {
  return e.now
    ? $gettext('The English name is cut short in the card. Keep it to about %{n} characters.', { n: String(e.maxChars) })
    : $gettext('In a longer language such as German, the name may be cut short. Keep the English name to about %{n} characters.', { n: String(e.maxChars) })
}

async function measure() {
  await nextTick()
  const out: Record<string, boolean> = {}
  for (const el of names.value)
    out[el.dataset.locale!] = el.scrollWidth > el.clientWidth + 1
  cut.value = out
  emit('results', out)
  estimate.value = estimateOf(names.value[0])
  emit('estimate', estimate.value)
}

// Whether the English name fits the card, and a third longer still would,
// unless a translation at least that long already shows the answer.
function estimateOf(el: HTMLElement | undefined): Estimate | null {
  const context = el && document.createElement('canvas').getContext('2d')
  const en = props.doc.name?.en ?? ''
  if (!el || !context || !en)
    return null
  context.font = getComputedStyle(el).font
  const width = (text: string) => context.measureText(text).width
  const available = el.clientWidth
  const enWidth = width(en)
  if (enWidth > available)
    return { now: true, maxChars: Math.max(1, Math.floor(en.length * available / enWidth)) }
  const proven = Object.entries(props.doc.name ?? {}).some(([l, text]) => l !== 'en' && width(text) >= enWidth * GROWTH)
  if (proven || enWidth * GROWTH <= available)
    return null
  return { now: false, maxChars: Math.max(1, Math.floor(en.length * available / (enWidth * GROWTH))) }
}

onMounted(measure)
watch(() => [props.doc, props.stress, props.locale], measure, { deep: true })
</script>

<template>
  <div class="row-wrap">
    <div class="head">
      <template v-if="stress === 'off'">
        <span class="font-500">{{ $gettext('Marketplace list card') }}</span>
        <span class="text-3 op-65">{{ $gettext('Cards in the list have a fixed width, a long name is cut short') }}</span>
      </template>
      <template v-else>
        <span class="font-500">{{ $gettext('List cards at their real width') }}</span>
        <span class="text-3 op-65">{{ $gettext('%{n} names are cut short', { n: String(Object.values(cut).filter(Boolean).length) }) }}</span>
      </template>
    </div>
    <div class="row" :class="theme">
      <article v-for="l in locales()" :key="l" class="card" :style="{ width: `${CARD_WIDTH}px` }" :dir="RTL_LOCALES.includes(l) ? 'rtl' : 'ltr'">
        <div class="card-head">
          <PluginIcon :src="iconUrl" :name="resolve(doc.name, 'en').text || '?'" :size="40" />
          <div class="min-w-0 flex-1">
            <span ref="names" class="name" :data-locale="l">{{ resolve(doc.name, l).text }}</span>
            <span class="sub">{{ stress === 'off' ? (author ?? '') : resolve(doc.name, l).fallback ? $gettext('%{lang}, shows English', { lang: localeName(l) }) : localeName(l) }}</span>
          </div>
          <span v-if="trust" class="trust">{{ trustText(l, trust) }}</span>
        </div>
        <p class="desc">
          {{ resolve(doc.description, l).text }}
        </p>
        <span v-if="cut[l]" class="flag"><span class="i-tabler-cut" />{{ $gettext('Name cut short') }}</span>
      </article>
    </div>
    <!-- With a stress test on, the results beside the preview say this. -->
    <div v-if="estimate && stress === 'off'" class="hint">
      <span class="i-tabler-alert-triangle" />
      {{ estimateText(estimate) }}
    </div>
  </div>
</template>

<style scoped>
.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--portal-warn-text);
}

.head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 13px;
}

.row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 12px;
  border: 1px solid var(--portal-border);
  border-radius: 10px;
  background: #f5f5f5;
}

.row.dark {
  background: #000;
}

.card {
  flex: none;
  position: relative;
  box-sizing: border-box;
  padding: 14px;
  border-radius: 10px;
  background: #fff;
  color: rgba(0, 0, 0, 0.88);
  border: 1px solid rgba(5, 5, 5, 0.06);
}

.dark .card {
  background: #141414;
  color: rgba(255, 255, 255, 0.85);
  border-color: #303030;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.name {
  display: block;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  opacity: 0.55;
}

.trust {
  flex: none;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 20px;
  background: rgba(0, 0, 0, 0.06);
}

.dark .trust {
  background: rgba(255, 255, 255, 0.1);
}

.desc {
  display: -webkit-box;
  margin: 10px 0 0;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 13px;
  opacity: 0.65;
}

.flag {
  position: absolute;
  top: -8px;
  inset-inline-end: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-radius: 10px;
  background: #faad14;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
}
</style>
