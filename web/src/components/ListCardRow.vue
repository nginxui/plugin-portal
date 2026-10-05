<script setup lang="ts">
import type { MarketEntry } from '@nginxui/plugin-market-ui'
import type { PreviewDoc } from './MarketPreview.vue'
import type { Stress } from '@/lib/market'
import { bundledText, MarketCard } from '@nginxui/plugin-market-ui'
import { theme as antTheme } from 'antdv-next'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { $gettext } from '@/lib/gettext'
import { HOST_LOCALES, RTL_LOCALES } from '@/lib/hostLocales'
import { localeName } from '@/lib/locales'
import { resolve } from '@/lib/market'

// Marketplace list cards at the width Nginx UI gives them, one per language,
// so a name cut short shows before it is listed. Each card is the one Nginx
// UI draws, in its own language as users see it, whatever the stress test
// does to the preview.
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
// A name wraps to a second line before the card cuts it.
const NAME_LINES = 2
const row = useTemplateRef<HTMLElement>('row')
const cut = ref<Record<string, boolean>>({})
const estimate = ref<Estimate | null>(null)

const locales = () => props.stress === 'off' ? [props.locale] : HOST_LOCALES

function estimateText(e: Estimate): string {
  return e.now
    ? $gettext('The English name is cut short in the card. Keep it to about %{n} characters.', { n: String(e.maxChars) })
    : $gettext('In a longer language such as German, the name may be cut short. Keep the English name to about %{n} characters.', { n: String(e.maxChars) })
}

const themeConfig = computed(() => ({ algorithm: props.theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm }))

// With a stress test on, the line under the name names each card's language instead.
const entry = computed<MarketEntry>(() => ({
  id: '',
  name: props.doc.name,
  description: props.doc.description,
  author: props.stress === 'off' ? props.author ?? undefined : undefined,
  icon_url: props.iconUrl ?? undefined,
  trust: props.trust ?? undefined,
}))

async function measure() {
  await nextTick()
  const out: Record<string, boolean> = {}
  const names = [...(row.value?.querySelectorAll<HTMLElement>('[data-locale] .pmu-card-name') ?? [])]
  for (const el of names)
    out[el.closest<HTMLElement>('[data-locale]')!.dataset.locale!] = el.scrollHeight > el.clientHeight + 1
  cut.value = out
  emit('results', out)
  estimate.value = estimateOf(names[0])
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
  const available = el.clientWidth * NAME_LINES
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
    <AConfigProvider :theme="themeConfig">
      <AFlex class="row">
        <div ref="row" class="cards">
          <div v-for="l in locales()" :key="l" class="slot" :data-locale="l" :style="{ width: `${CARD_WIDTH}px` }" :dir="RTL_LOCALES.includes(l) ? 'rtl' : 'ltr'">
            <MarketCard :entry="entry" :locale="l" :translate="bundledText(l)">
              <template v-if="stress !== 'off'" #sub>
                <span>{{ resolve(doc.name, l).fallback ? $gettext('%{lang}, shows English', { lang: localeName(l) }) : localeName(l) }}</span>
              </template>
            </MarketCard>
            <span v-if="cut[l]" class="flag"><span class="i-tabler-cut" />{{ $gettext('Name cut short') }}</span>
          </div>
        </div>
      </AFlex>
    </AConfigProvider>
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
  overflow-x: auto;
  padding: 16px 12px 12px;
  border: 1px solid var(--portal-border);
  border-radius: 10px;
  background: var(--ant-color-bg-layout);
}

.cards {
  display: flex;
  gap: 16px;
}

.slot {
  position: relative;
  flex: none;
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
