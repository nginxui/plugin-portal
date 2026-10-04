<script setup lang="ts">
import type { PreviewDoc } from './MarketPreview.vue'
import type { Stress } from '@/lib/market'
import { nextTick, onMounted, ref, watch } from 'vue'
import { $gettext } from '@/lib/gettext'
import { HOST_LOCALES, RTL_LOCALES } from '@/lib/hostLocales'
import { resolve, trustText } from '@/lib/market'

// Marketplace list cards at the width Nginx UI gives them, one per language,
// so a name cut short shows before it is listed.
const props = defineProps<{ doc: PreviewDoc, locale: string, stress: Stress, trust: string | null, theme: 'light' | 'dark' }>()
const emit = defineEmits<{ results: [cut: Record<string, boolean>] }>()

const CARD_WIDTH = 320
const names = ref<HTMLElement[]>([])
const cut = ref<Record<string, boolean>>({})

const locales = () => props.stress === 'off' ? [props.locale] : HOST_LOCALES

async function measure() {
  await nextTick()
  const out: Record<string, boolean> = {}
  for (const el of names.value)
    out[el.dataset.locale!] = el.scrollWidth > el.clientWidth + 1
  cut.value = out
  emit('results', out)
}

onMounted(measure)
watch(() => [props.doc, props.stress, props.locale], measure, { deep: true })
</script>

<template>
  <div class="row-wrap">
    <div class="head">
      <span class="font-500">{{ $gettext('List cards at their real width') }}</span>
      <span class="text-3 op-65">{{ $gettext('%{n} names are cut short', { n: String(Object.values(cut).filter(Boolean).length) }) }}</span>
    </div>
    <div class="row" :class="theme">
      <article v-for="l in locales()" :key="l" class="card" :style="{ width: `${CARD_WIDTH}px` }" :dir="stress === 'rtl' || RTL_LOCALES.includes(l) ? 'rtl' : 'ltr'">
        <div class="card-head">
          <span class="icon">{{ (resolve(doc.name, l).text || '?').slice(0, 1).toUpperCase() }}</span>
          <div class="min-w-0 flex-1">
            <span ref="names" class="name" :data-locale="l">{{ resolve(doc.name, l, stress).text }}</span>
            <span class="sub">{{ l }}</span>
          </div>
          <span v-if="trust" class="trust">{{ trustText(l, trust) }}</span>
        </div>
        <p class="desc">
          {{ resolve(doc.description, l, stress).text }}
        </p>
        <span v-if="cut[l]" class="flag"><span class="i-tabler-cut" />{{ $gettext('Name cut short') }}</span>
      </article>
    </div>
  </div>
</template>

<style scoped>
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

.icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #e6f4ff;
  color: #1677ff;
  font-weight: 600;
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
