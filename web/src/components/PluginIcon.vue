<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{ src?: string | null, name: string, size?: number }>(), { size: 40 })

const failed = ref(false)
const initial = computed(() => props.name.trim().slice(0, 1).toUpperCase())

// A steady color per plugin name, so a plugin without an icon is still recognizable.
const COLORS = ['#1677ff', '#cf1322', '#d46b08', '#13a8a8', '#389e0d', '#722ed1', '#c41d7f', '#0958d9']
const color = computed(() => {
  let hash = 0
  for (const ch of props.name)
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length]
})
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    alt=""
    :width="size"
    :height="size"
    class="plugin-icon"
    @error="failed = true"
  >
  <span v-else class="plugin-icon fallback" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.45}px`, background: color }">
    {{ initial }}
  </span>
</template>

<style scoped>
.plugin-icon {
  flex: none;
  border-radius: 25%;
}

.fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: #fff;
}
</style>
