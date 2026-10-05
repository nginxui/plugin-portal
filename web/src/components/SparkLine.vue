<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ values: number[] }>()

const max = computed(() => Math.max(...props.values, 1))
const y = (v: number) => (28 - v * 26 / max.value).toFixed(1)
// One value has no trend; it shows as a level line.
const points = computed(() => {
  if (props.values.length === 1)
    return '0,16 100,16'
  const step = 100 / (props.values.length - 1)
  return props.values.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`).join(' ')
})
</script>

<template>
  <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
    <polyline :points="points" fill="none" stroke="var(--portal-primary)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
  </svg>
</template>

<style scoped>
.spark {
  display: block;
  width: 100%;
  height: 32px;
}
</style>
