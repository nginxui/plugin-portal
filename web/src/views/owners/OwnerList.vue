<script setup lang="ts">
import type { OwnerSummary } from '@/api/plugins'
import { onMounted, ref } from 'vue'
import { getOwners } from '@/api/plugins'
import { $gettext, $ngettext } from '@/lib/gettext'
import { roleLabel } from '@/lib/labels'

const owners = ref<OwnerSummary[]>([])
const loading = ref(true)
const failed = ref(false)

onMounted(async () => {
  try {
    owners.value = (await getOwners()).owners
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <div>
      <h1 class="page-title">
        {{ $gettext('Organizations') }}
      </h1>
      <ATypographyText type="secondary">
        {{ $gettext('The accounts and organizations that own the plugins you work on. Names, avatars and members come from GitHub.') }}
      </ATypographyText>
    </div>
    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The organizations could not be loaded.')" />
    <ACard :loading="loading">
      <AEmpty v-if="owners.length === 0" :description="$gettext('You have no role on any listed plugin yet.')" />
      <AFlex v-for="owner in owners" :key="owner.login" align="center" gap="middle" class="py-3">
        <AAvatar :src="owner.avatarUrl ?? undefined" :size="40">
          {{ owner.login.slice(0, 1).toUpperCase() }}
        </AAvatar>
        <div class="flex-1 min-w-0">
          <div class="font-600">
            {{ owner.login }}
          </div>
          <div class="text-3 op-65">
            {{ owner.kind === 'organization' ? $gettext('GitHub organization') : $gettext('Personal account') }},
            {{ $ngettext('%{n} plugin', '%{n} plugins', owner.plugins, { n: String(owner.plugins) }) }},
            {{ roleLabel(owner.role) }}
          </div>
        </div>
        <RouterLink :to="`/owners/${owner.login}`">
          <AButton>{{ $gettext('Open') }}</AButton>
        </RouterLink>
      </AFlex>
    </ACard>
  </div>
</template>
