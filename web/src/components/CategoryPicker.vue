<script setup lang="ts">
import { computed, ref } from 'vue'
import { categoryIcon, categoryLabel } from '@/lib/categories'
import { $gettext } from '@/lib/gettext'

const props = withDefaults(defineProps<{ options: string[], suggested?: string[], max?: number }>(), { suggested: () => [], max: 3 })
const model = defineModel<string[]>({ required: true })

const full = computed(() => model.value.length >= props.max)
const hint = ref(false)

function toggle(id: string) {
  if (model.value.includes(id)) {
    model.value = model.value.filter(item => item !== id)
    hint.value = false
  }
  else if (full.value) {
    hint.value = true
  }
  else {
    model.value = [...model.value, id]
  }
}
</script>

<template>
  <div class="picker">
    <div class="pills" role="group" :aria-label="$gettext('Categories')">
      <button
        v-for="id in options"
        :key="id"
        type="button"
        class="pill"
        :class="{ on: model.includes(id), dim: full && !model.includes(id) }"
        :aria-pressed="model.includes(id)"
        @click="toggle(id)"
      >
        <span :class="model.includes(id) ? 'i-tabler-check' : categoryIcon(id)" class="pill-icon" />
        <span>{{ categoryLabel(id) }}</span>
        <span v-if="suggested.includes(id)" class="pill-tag">{{ $gettext('Suggested') }}</span>
      </button>
    </div>
    <div class="meta">
      <span :class="{ warn: hint }">
        {{ hint ? $gettext('Up to three. Remove one to choose another.') : $gettext('Up to three. Suggested ones come from the capabilities of the plugin.') }}
      </span>
      <span class="count">{{ $gettext('%{n} of %{max} chosen', { n: String(model.length), max: String(max) }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pill {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid var(--portal-border-strong);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, opacity 0.15s;
}

.pill:hover {
  border-color: var(--portal-primary);
  color: var(--portal-primary);
}

.pill:focus-visible {
  outline: 2px solid var(--portal-primary);
  outline-offset: 1px;
}

.pill.on {
  border-color: var(--portal-primary);
  background: var(--portal-primary-bg);
  color: var(--portal-primary-text);
  font-weight: 500;
}

.pill.dim {
  opacity: 0.5;
}

.pill-icon {
  font-size: 15px;
  opacity: 0.75;
}

.pill.on .pill-icon {
  opacity: 1;
}

.pill-tag {
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 18px;
  font-weight: 400;
  color: var(--portal-primary-text);
  background: var(--portal-primary-bg);
}

.pill.on .pill-tag {
  background: var(--portal-card);
}

.meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.75;
}

.meta .warn {
  color: #d48806;
  opacity: 1;
}

.count {
  white-space: nowrap;
}
</style>
