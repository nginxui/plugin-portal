<script setup lang="ts">
import type { VendorSummary } from '@/api/partners'
import type { OwnerSummary } from '@/api/plugins'
import { onMounted, ref } from 'vue'
import { getVendors } from '@/api/partners'
import { getOwners } from '@/api/plugins'
import { $gettext, $ngettext } from '@/lib/gettext'
import { roleLabel } from '@/lib/labels'

const owners = ref<OwnerSummary[]>([])
const vendors = ref<VendorSummary[]>([])
const loading = ref(true)
const failed = ref(false)

onMounted(async () => {
  try {
    const [list, mine] = await Promise.all([getOwners(), getVendors().catch(() => ({ vendors: [] }))])
    owners.value = list.owners
    vendors.value = mine.vendors
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
      <AEmpty v-if="owners.length === 0 && vendors.length === 0" :description="$gettext('You have no role on any listed plugin yet.')" />
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
      <AFlex v-for="vendor in vendors" :key="vendor.id" align="center" gap="middle" class="py-3">
        <AAvatar :size="40" shape="square">
          {{ (vendor.name ?? '?').slice(0, 2).toUpperCase() }}
        </AAvatar>
        <div class="flex-1 min-w-0">
          <div class="font-600">
            {{ vendor.name }}
          </div>
          <div class="text-3 op-65">
            {{ $gettext('Vendor without a public repository') }}, {{ roleLabel(vendor.role) }}
          </div>
        </div>
        <RouterLink :to="`/vendors/${vendor.id}`">
          <AButton>{{ $gettext('Open') }}</AButton>
        </RouterLink>
      </AFlex>
    </ACard>
  </div>
</template>
