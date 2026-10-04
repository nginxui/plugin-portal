<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{ src?: string | null, name: string, size?: number }>(), { size: 40 })

const failed = ref(false)
const initial = computed(() => props.name.trim().slice(0, 1).toUpperCase())
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
  <span v-else class="plugin-icon fallback" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.45}px` }">
    {{ initial }}
  </span>
</template>

<style scoped>
.plugin-icon {
  flex: none;
  border-radius: 8px;
}

.fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: var(--portal-primary-text);
  background: var(--portal-primary-bg);
}
</style>
