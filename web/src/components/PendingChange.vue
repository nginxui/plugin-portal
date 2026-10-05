<script setup lang="ts">
import { computed } from 'vue'
import { changePath, kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { usePluginStore } from '@/stores/plugin'

const store = usePluginStore()
const pending = computed(() => store.detail?.pending ?? null)
</script>

<template>
  <AAlert v-if="pending" type="info" show-icon :title="$gettext('%{kind} is in progress. Other changes can be made once it is done.', { kind: kindLabel(pending.kind) })">
    <template #action>
      <RouterLink :to="changePath(pending)">
        <AButton size="small">
          {{ $gettext('View progress') }}
        </AButton>
      </RouterLink>
    </template>
  </AAlert>
</template>
