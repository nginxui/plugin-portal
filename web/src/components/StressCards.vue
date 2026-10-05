<script setup lang="ts">
import type { MarketEntry } from '@nginxui/plugin-market-ui'
import type { PreviewDoc } from './MarketPreview.vue'
import { bundledText, MarketCard } from '@nginxui/plugin-market-ui'
import { theme as antTheme } from 'antdv-next'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { $gettext } from '@/lib/gettext'
import { localeName } from '@/lib/locales'

// The stress tests side by side, each as the marketplace list card Nginx UI
// draws, at the width it gives it, with what it found.

export interface StressResults {
  longest: { locale: string, cut: boolean }
  rtl: { cut: boolean, translated: boolean }
}

const props = defineProps<{ doc: PreviewDoc, trust: string | null, theme: 'light' | 'dark', author: string | null, iconUrl?: string | null }>()
const emit = defineEmits<{ results: [results: StressResults] }>()

const CARD_WIDTH = 320
const RTL = 'ar'

const longestLocale = computed(() => Object.entries(props.doc.name ?? {}).reduce((a, b) => (b[1].length > a[1].length ? b : a), ['en', ''])[0])
const samples = computed(() => [
  { key: 'longest' as const, title: $gettext('Longest language: %{lang}', { lang: localeName(longestLocale.value) }), locale: longestLocale.value, rtl: false },
  { key: 'rtl' as const, title: $gettext('Right to left: %{lang}', { lang: localeName(RTL) }), locale: RTL, rtl: true },
])

const themeConfig = computed(() => ({ algorithm: props.theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm }))
const entry = computed<MarketEntry>(() => ({
  id: '',
  name: props.doc.name,
  description: props.doc.description,
  author: props.author ?? undefined,
  icon_url: props.iconUrl ?? undefined,
  trust: props.trust ?? undefined,
}))

const grid = useTemplateRef<HTMLElement>('grid')
const cut = ref<Record<string, boolean>>({})

async function measure() {
  await nextTick()
  const out: Record<string, boolean> = {}
  for (const el of grid.value?.querySelectorAll<HTMLElement>('[data-key] .pmu-card-name') ?? [])
    out[el.closest<HTMLElement>('[data-key]')!.dataset.key!] = el.scrollHeight > el.clientHeight + 1
  cut.value = out
  emit('results', {
    longest: { locale: longestLocale.value, cut: !!out.longest },
    rtl: { cut: !!out.rtl, translated: !!props.doc.name?.[RTL] },
  })
}

onMounted(measure)
watch(() => props.doc, measure, { deep: true })

function verdict(key: string) {
  if (cut.value[key])
    return { tone: 'bad', text: $gettext('The name is cut short') }
  return { tone: 'ok', text: $gettext('Shows in full') }
}
</script>

<template>
  <ACard :title="$gettext('Marketplace cards')">
    <template #extra>
      <span class="text-3 op-65 extra-hint">{{ $gettext('Cards in the list have a fixed width, a long name is cut short') }}</span>
    </template>
    <AConfigProvider :theme="themeConfig">
      <AFlex class="stage">
        <div ref="grid" class="grid3">
          <div v-for="sample in samples" :key="sample.key" class="sample">
            <div class="text-3 op-65 mb-2">
              {{ sample.title }}
            </div>
            <div class="card-slot" :class="{ cut: cut[sample.key] }" :data-key="sample.key" :style="{ maxWidth: `${CARD_WIDTH}px` }" :dir="sample.rtl ? 'rtl' : 'ltr'">
              <MarketCard :entry="entry" :locale="sample.locale" :translate="bundledText(sample.locale)" />
            </div>
            <div class="text-3 mt-2" :class="verdict(sample.key).tone === 'bad' ? 'c-bad' : 'c-ok'">
              {{ verdict(sample.key).text }}
            </div>
          </div>
        </div>
      </AFlex>
    </AConfigProvider>
  </ACard>
</template>

<style scoped>
.stage {
  display: block;
  padding: 12px;
  border-radius: 10px;
  background: var(--ant-color-bg-layout);
  color: var(--ant-color-text);
}

.grid3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.card-slot.cut :deep(.pmu-card-name) {
  border-radius: 4px;
  outline: 2px dashed var(--ant-color-error);
  outline-offset: 2px;
}

.c-bad {
  color: var(--ant-color-error);
}

.c-ok {
  color: var(--ant-color-success);
}
</style>
