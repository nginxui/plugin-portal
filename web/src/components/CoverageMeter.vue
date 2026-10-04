<script setup lang="ts">
defineProps<{ label: string, percent: number, text: string }>()
</script>

<template>
  <div class="meter">
    <span class="label">{{ label }}</span>
    <span class="bar"><span :style="{ width: `${Math.min(100, Math.max(0, percent))}%` }" /></span>
    <span class="text">{{ text }}</span>
  </div>
</template>

<style scoped>
.meter {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.label {
  width: 72px;
  flex: none;
  opacity: 0.65;
}

.bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--portal-faint);
  box-shadow: inset 0 0 0 1px var(--portal-border);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--portal-primary);
}

.text {
  min-width: 72px;
  flex: none;
  text-align: right;
  white-space: nowrap;
}
</style>
