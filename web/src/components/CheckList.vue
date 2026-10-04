<script setup lang="ts">
import type { Check } from '@/api/submit'
import { checkDetail, checkTitle } from '@/lib/checks'

defineProps<{ checks: Check[] }>()

const icons = {
  pass: 'i-tabler-circle-check-filled text-green-600',
  warn: 'i-tabler-alert-triangle-filled text-amber-500',
  fail: 'i-tabler-circle-x-filled text-red-600',
}
</script>

<template>
  <ul class="check-list">
    <li v-for="check in checks" :key="check.key">
      <span :class="icons[check.status]" class="text-5 flex-none" />
      <div class="min-w-0">
        <div class="font-500">
          {{ checkTitle(check) }}
        </div>
        <div class="text-3 op-70 break-words">
          {{ checkDetail(check) }}
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.check-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.check-list li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
</style>
