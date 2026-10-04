<script setup lang="ts">
import type { OwnerDetail } from '@/api/plugins'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getOwner } from '@/api/plugins'
import { $gettext } from '@/lib/gettext'

const route = useRoute()
const router = useRouter()
const data = ref<OwnerDetail | null>(null)
// Read only, so the template keeps its null check inside slots.
const detail = computed(() => data.value)
const missing = ref(false)

const login = computed(() => String(route.params.login))

const crumbs = computed(() => [
  {
    title: $gettext('Organizations'),
    href: '/owners',
    onClick: (e: MouseEvent) => {
      e.preventDefault()
      router.push('/owners')
    },
  },
  { title: detail.value?.owner.login ?? login.value },
])

watch(login, async (value) => {
  data.value = null
  missing.value = false
  try {
    data.value = await getOwner(value)
  }
  catch {
    missing.value = true
  }
}, { immediate: true })
</script>

<template>
  <div class="page">
    <AResult
      v-if="missing"
      status="404"
      :title="$gettext('Organization not found')"
      :sub-title="$gettext('You have no role on any plugin of this account.')"
    />
    <template v-else-if="detail">
      <ABreadcrumb :items="crumbs" />
      <AFlex align="center" gap="middle" wrap>
        <AAvatar :src="detail.owner.avatarUrl ?? undefined" :size="56">
          {{ detail.owner.login.slice(0, 1).toUpperCase() }}
        </AAvatar>
        <div class="flex-1 min-w-0">
          <h1 class="page-title m-0">
            {{ detail.owner.login }}
          </h1>
          <ATypographyText type="secondary">
            {{ $gettext('Name, avatar and members come from GitHub') }}
          </ATypographyText>
        </div>
        <AButton :href="`https://github.com/${login}`" target="_blank">
          <span class="i-tabler-brand-github" />
          {{ detail?.owner.kind === 'organization' ? $gettext('View organization on GitHub') : $gettext('View account on GitHub') }}
        </AButton>
      </AFlex>
      <div class="cols">
        <ACard :title="$gettext('Plugins')" class="col-main">
          <ATypographyParagraph type="secondary">
            {{ $gettext('Plugins of this account you have a role on. Each role follows your permission on that repository.') }}
          </ATypographyParagraph>
          <PluginRow v-for="plugin in detail?.plugins" :key="plugin.id" :plugin="plugin" />
        </ACard>
        <ACard :title="$gettext('Members and access')" class="col-side">
          <ATypographyParagraph type="secondary">
            {{ $gettext('Members and permissions are managed on GitHub. The Developer Center decides what each person may do from their repository permission.') }}
          </ATypographyParagraph>
          <a v-if="detail?.accessUrl" :href="detail.accessUrl" target="_blank" rel="noopener">
            {{ $gettext('Manage teams and repository access on GitHub') }}
            <span class="i-tabler-external-link" />
          </a>
        </ACard>
      </div>
    </template>
    <ASkeleton v-else active avatar />
  </div>
</template>
