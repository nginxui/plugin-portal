<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ values: number[] }>()

const points = computed(() => {
  const max = Math.max(...props.values, 1)
  const step = props.values.length > 1 ? 100 / (props.values.length - 1) : 0
  return props.values.map((v, i) => `${(i * step).toFixed(1)},${(28 - v * 26 / max).toFixed(1)}`).join(' ')
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
