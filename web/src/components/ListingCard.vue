<script setup lang="ts">
import type { Draft } from '@/api/submit'
import { computed } from 'vue'
import { categoryLabel } from '@/lib/categories'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'

const props = defineProps<{ draft: Draft, categories: string[] }>()

const name = computed(() => localized(props.draft.name) || props.draft.id)
const owner = computed(() => props.draft.repo.split('/')[0])
const description = computed(() => localized(props.draft.description))
</script>

<template>
  <div class="listing">
    <PluginIcon :name="name" :size="48" />
    <div class="min-w-0 flex-1">
      <div class="font-600">
        {{ name }}
      </div>
      <div class="text-3 op-65">
        {{ owner }}
      </div>
      <p v-if="description" class="desc">
        {{ description }}
      </p>
      <AFlex gap="4" wrap class="mt-2">
        <ATag v-for="id in categories" :key="id" class="m-0">
          {{ categoryLabel(id) }}
        </ATag>
        <ATag class="m-0">
          v{{ draft.version }}
        </ATag>
        <ATag class="m-0">
          {{ $gettext('Community') }}
        </ATag>
      </AFlex>
    </div>
  </div>
</template>

<style scoped>
.listing {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 16px;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
}

.desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
}
</style>
