<script setup lang="ts">
import type { PluginSummary } from '@/api/plugins'
import { computed } from 'vue'
import { $gettext } from '@/lib/gettext'
import { localized, roleLabel, stateTag, trustLabel } from '@/lib/labels'

const props = defineProps<{ plugin: PluginSummary }>()

const name = computed(() => localized(props.plugin.name))
const state = computed(() => stateTag(props.plugin.state))
</script>

<template>
  <div class="plugin-row">
    <PluginIcon :src="plugin.iconUrl" :name="name" />
    <div class="grow min-w-0">
      <AFlex gap="small" align="center" wrap>
        <span class="font-600">{{ name }}</span>
        <ATag :color="state.color" class="m-0">
          {{ state.label }}
        </ATag>
        <ATag v-if="trustLabel(plugin.trust)" class="m-0">
          {{ trustLabel(plugin.trust) }}
        </ATag>
      </AFlex>
      <div class="mono text-3 op-65">
        {{ plugin.id }}
      </div>
      <AFlex gap="small" wrap class="text-3 op-65 mt-1">
        <span v-if="plugin.version">v{{ plugin.version }}</span>
        <span v-if="plugin.owner">{{ plugin.owner.login }}</span>
        <span>{{ roleLabel(plugin.role) }}</span>
      </AFlex>
    </div>
    <RouterLink :to="`/plugins/${plugin.id}`">
      <AButton :type="plugin.state === 'listed' ? 'primary' : 'default'">
        {{ $gettext('Manage') }}
      </AButton>
    </RouterLink>
  </div>
</template>

<style scoped>
.plugin-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--portal-border);
}

.plugin-row:last-child {
  border-bottom: 0;
}

.grow {
  flex: 1;
}
</style>
