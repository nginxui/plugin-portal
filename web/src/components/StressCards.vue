<script setup lang="ts">
import type { PreviewDoc } from './MarketPreview.vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { $gettext } from '@/lib/gettext'
import { localeName } from '@/lib/locales'
import { resolve, trustText } from '@/lib/market'

// The stress tests side by side, each as a marketplace list card at
// the width Nginx UI gives it, with what it found.

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
  { key: 'longest' as const, title: $gettext('Longest language: %{lang}', { lang: localeName(longestLocale.value) }), locale: longestLocale.value, name: resolve(props.doc.name, longestLocale.value).text, rtl: false },
  { key: 'rtl' as const, title: $gettext('Right to left: %{lang}', { lang: localeName(RTL) }), locale: RTL, name: resolve(props.doc.name, RTL).text, rtl: true },
])

const names = ref<HTMLElement[]>([])
const cut = ref<Record<string, boolean>>({})

async function measure() {
  await nextTick()
  const out: Record<string, boolean> = {}
  for (const el of names.value)
    out[el.dataset.key!] = el.scrollWidth > el.clientWidth + 1
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
      <span class="text-3 op-65">{{ $gettext('Cards in the list have a fixed width, a long name is cut short') }}</span>
    </template>
    <div class="grid3" :class="theme">
      <div v-for="sample in samples" :key="sample.key" class="sample">
        <div class="text-3 op-65 mb-2">
          {{ sample.title }}
        </div>
        <article class="card" :style="{ maxWidth: `${CARD_WIDTH}px` }" :dir="sample.rtl ? 'rtl' : 'ltr'">
          <div class="card-head">
            <PluginIcon :src="iconUrl" :name="resolve(doc.name, 'en').text || '?'" :size="40" />
            <div class="min-w-0 flex-1">
              <span ref="names" class="name" :class="{ cut: cut[sample.key] }" :data-key="sample.key">{{ sample.name }}</span>
              <span class="sub">{{ author }}</span>
            </div>
            <span v-if="trust" class="trust">{{ trustText(sample.locale, trust) }}</span>
          </div>
        </article>
        <div class="text-3 mt-2" :class="verdict(sample.key).tone === 'bad' ? 'c-bad' : 'c-ok'">
          {{ verdict(sample.key).text }}
        </div>
      </div>
    </div>
  </ACard>
</template>

<style scoped>
.grid3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.card {
  box-sizing: border-box;
  padding: 14px;
  border-radius: 10px;
  background: #fff;
  color: rgba(0, 0, 0, 0.88);
  border: 1px solid rgba(5, 5, 5, 0.08);
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
  border-radius: 4px;
}

.name.cut {
  outline: 2px dashed #cf1322;
  outline-offset: 2px;
}

.sub {
  font-size: 12px;
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

.c-bad {
  color: #cf1322;
}

.c-ok {
  color: #389e0d;
}
</style>
