<script setup lang="ts">
import type { Role } from '@/api/plugins'
import { computed } from 'vue'
import { $gettext } from '@/lib/gettext'
import { roleDescription, roleLabel } from '@/lib/labels'
import { fromNow } from '@/lib/time'
import { usePluginStore } from '@/stores/plugin'
import { useSessionStore } from '@/stores/session'

const store = usePluginStore()
const session = useSessionStore()
const plugin = computed(() => store.detail!.plugin)
const access = computed(() => store.detail!.access)

const mapping = computed<{ permission: string, role: Role }[]>(() => [
  { permission: 'admin', role: 'admin' },
  { permission: 'maintain, write', role: 'publisher' },
  { permission: 'triage', role: 'translator' },
])
</script>

<template>
  <div class="cols">
    <AFlex vertical gap="middle" class="col-main">
      <ACard :title="$gettext('Your access')">
        <template v-if="access.checkedAt" #extra>
          <ATypographyText type="secondary" class="text-3">
            {{ $gettext('Read from GitHub %{time}', { time: fromNow(access.checkedAt) }) }}
          </ATypographyText>
        </template>
        <AFlex align="center" gap="middle" wrap>
          <AAvatar :src="session.user?.avatarUrl ?? undefined" :size="40">
            {{ session.user?.login.slice(0, 1).toUpperCase() }}
          </AAvatar>
          <div class="flex-1 min-w-0">
            <AFlex gap="small" align="center">
              <span class="font-600">{{ session.user?.login }}</span>
              <ATag :color="access.role ? 'blue' : 'default'" class="m-0">
                {{ roleLabel(access.role) }}
              </ATag>
            </AFlex>
            <ATypographyText v-if="access.role && access.permission" type="secondary" class="text-3">
              {{ $gettext('From your %{permission} permission on %{repo}', { permission: access.permission, repo: plugin.repo ?? '' }) }}
            </ATypographyText>
            <ATypographyText v-else type="secondary" class="text-3">
              {{ $gettext('You can view this plugin as a maintainer.') }}
            </ATypographyText>
          </div>
          <AButton v-if="access.manageUrl" :href="access.manageUrl" target="_blank">
            {{ $gettext('Manage access on GitHub') }}
            <span class="i-tabler-external-link" />
          </AButton>
        </AFlex>
      </ACard>
      <ACard :title="$gettext('Roles')">
        <template #extra>
          <ATypographyText type="secondary" class="text-3">
            {{ $gettext('The Developer Center keeps no separate members or roles') }}
          </ATypographyText>
        </template>
        <div class="overflow-x-auto">
          <table class="role-table">
            <thead>
              <tr>
                <th>{{ $gettext('Repository permission on GitHub') }}</th>
                <th>{{ $gettext('Role') }}</th>
                <th>{{ $gettext('What it allows') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in mapping" :key="row.role">
                <td class="mono">
                  {{ row.permission }}
                </td>
                <td class="whitespace-nowrap">
                  {{ roleLabel(row.role) }}
                </td>
                <td>{{ roleDescription(row.role) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ATypographyParagraph type="secondary" class="mt-4 mb-0 text-3">
          {{ $gettext('When someone loses their permission on GitHub, their role in the Developer Center ends with it.') }}
        </ATypographyParagraph>
      </ACard>
    </AFlex>
    <AFlex vertical gap="middle" class="col-side">
      <ACard v-if="plugin.owner" :title="$gettext('Owner')">
        <AFlex align="center" gap="middle">
          <AAvatar :src="plugin.owner.avatarUrl ?? undefined" :size="40">
            {{ plugin.owner.login.slice(0, 1).toUpperCase() }}
          </AAvatar>
          <div>
            <RouterLink :to="`/owners/${plugin.owner.login}`" class="font-600">
              {{ plugin.owner.login }}
            </RouterLink>
            <div class="text-3 op-65">
              {{ plugin.owner.kind === 'organization' ? $gettext('GitHub organization') : $gettext('Personal account') }}
            </div>
          </div>
        </AFlex>
        <ATypographyParagraph type="secondary" class="mt-4 mb-0 text-3">
          {{ $gettext('The owner is the owner of the repository. When the repository moves to another owner on GitHub, the plugin moves with it after review.') }}
        </ATypographyParagraph>
      </ACard>
    </AFlex>
  </div>
</template>

<style scoped>
.role-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 520px;
}

.role-table th,
.role-table td {
  text-align: left;
  padding: 12px 16px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: top;
}

.role-table th {
  font-weight: 600;
  background: var(--portal-faint);
  white-space: nowrap;
}
</style>
