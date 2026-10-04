<script setup lang="ts">
import { computed, ref } from 'vue'
import { $gettext } from '@/lib/gettext'
import { HOST_LOCALES } from '@/lib/hostLocales'
import { localeName } from '@/lib/locales'

// A searchable list of the host languages with how much of the plugin is
// translated into each, translated ones first.
const props = defineProps<{ coverage: Record<string, number> }>()
const model = defineModel<string>({ required: true })

const open = ref(false)
const query = ref('')

const items = computed(() => {
  const q = query.value.trim().toLowerCase()
  return HOST_LOCALES
    .map(code => ({ code, name: localeName(code), pct: Math.round((props.coverage[code] ?? 0) * 100) }))
    .filter(i => !q || i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q))
})
const done = computed(() => items.value.filter(i => i.pct > 0))
const todo = computed(() => items.value.filter(i => i.pct === 0))

function pick(code: string) {
  model.value = code
  open.value = false
  query.value = ''
}
</script>

<template>
  <APopover v-model:open="open" trigger="click" placement="bottomLeft" :arrow="false">
    <AButton>
      <span class="i-tabler-world" />
      {{ localeName(model) }}
      <span class="i-tabler-chevron-down text-3" />
    </AButton>
    <template #content>
      <div class="picker">
        <AInput v-model:value="query" size="small" allow-clear :placeholder="$gettext('Search languages')" :aria-label="$gettext('Search languages')" />
        <template v-if="done.length">
          <div class="group">
            {{ $gettext('Translated, %{n}', { n: String(done.length) }) }}
          </div>
          <button v-for="item in done" :key="item.code" type="button" class="item" :class="{ on: item.code === model }" @click="pick(item.code)">
            <span class="code">{{ item.code }}</span>
            <span class="name" dir="auto">{{ item.name }}</span>
            <span class="bar"><span :style="{ width: `${item.pct}%` }" /></span>
            <span class="pct">{{ item.pct }}%</span>
          </button>
        </template>
        <template v-if="todo.length">
          <div class="group">
            {{ $gettext('Not translated, shows English') }}
          </div>
          <button v-for="item in todo" :key="item.code" type="button" class="item" :class="{ on: item.code === model }" @click="pick(item.code)">
            <span class="code">{{ item.code }}</span>
            <span class="name" dir="auto">{{ item.name }}</span>
            <span class="bar"><span style="width: 0" /></span>
            <span class="pct">0%</span>
          </button>
        </template>
      </div>
    </template>
  </APopover>
</template>

<style scoped>
.picker {
  width: 300px;
  max-height: 420px;
  overflow-y: auto;
}

.group {
  padding: 10px 6px 4px;
  font-size: 12px;
  opacity: 0.6;
}

.item {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.item:hover,
.item:focus-visible {
  background: var(--portal-faint);
}

.item.on {
  background: var(--portal-primary-bg);
}

.code {
  width: 44px;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  opacity: 0.6;
}

.name {
  flex: 1;
  min-width: 0;
}

.bar {
  width: 56px;
  height: 4px;
  border-radius: 2px;
  background: var(--portal-border);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--portal-primary);
}

.pct {
  width: 34px;
  text-align: right;
  font-size: 12px;
  opacity: 0.6;
}
</style>
