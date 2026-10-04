<script setup lang="ts">
import type { OrgPage, VendorSummary } from '@/api/partners'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { applyPartner, getOrg, getVendors } from '@/api/partners'
import { getOwners } from '@/api/plugins'
import { $gettext } from '@/lib/gettext'
import { localized, roleLabel, trustLabel } from '@/lib/labels'
import { fromNow } from '@/lib/time'

// A GitHub organization or account: its plugins in the catalog with the
// user's role on each, and its partner application (spec 11.4).

const route = useRoute()
const router = useRouter()
const data = ref<OrgPage | null>(null)
const detail = computed(() => data.value)
// The loaded page, for slots where the template cannot narrow it.
const D = computed(() => data.value as OrgPage)
const missing = ref(false)
const login = computed(() => String(route.params.login))

async function load() {
  data.value = null
  missing.value = false
  try {
    data.value = await getOrg(login.value)
  }
  catch {
    missing.value = true
  }
}
watch(login, load, { immediate: true })

const mine = ref<{ owners: { login: string, kind: string, plugins: number }[], vendors: VendorSummary[] }>({ owners: [], vendors: [] })
onMounted(async () => {
  const [owners, vendors] = await Promise.all([getOwners().catch(() => ({ owners: [] })), getVendors().catch(() => ({ vendors: [] }))])
  mine.value = { owners: owners.owners, vendors: vendors.vendors }
})

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

function stateTag(state: string) {
  return state === 'listed' ? { color: 'success', text: $gettext('Listed') } : state === 'delisted' ? { color: 'error', text: $gettext('Delisted') } : { color: 'processing', text: $gettext('In review') }
}

// The partner application.
const applying = ref(false)
const sending = ref(false)
const error = ref('')
const form = ref({ name: '', display_name: '', homepage_url: '', description: '', public_key: '', note: '' })
function openApply() {
  form.value = { name: login.value.toLowerCase(), display_name: detail.value?.owner.name ?? login.value, homepage_url: '', description: '', public_key: '', note: '' }
  error.value = ''
  applying.value = true
}
async function sendApply() {
  sending.value = true
  error.value = ''
  try {
    await applyPartner(login.value, form.value)
    applying.value = false
    await load()
  }
  catch (e) {
    const code = (e as { code?: string }).code
    error.value = code === 'pending'
      ? $gettext('An application of this organization is waiting for a maintainer.')
      : $gettext('Check the fields: a partner name of lower case letters, a display name and a minisign public key.')
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="page">
    <AResult v-if="missing" status="404" :title="$gettext('Organization not found')" :sub-title="$gettext('There is no GitHub account with this name.')" />
    <template v-else-if="detail">
      <ABreadcrumb :items="crumbs" />
      <ACard>
        <AFlex align="center" gap="middle" wrap>
          <AAvatar :src="D.owner.avatarUrl ?? undefined" :size="56" shape="square">
            {{ D.owner.login.slice(0, 2).toUpperCase() }}
          </AAvatar>
          <div class="flex-1 min-w-0">
            <AFlex align="center" gap="small" wrap>
              <h1 class="page-title m-0">
                {{ D.owner.login }}
              </h1>
              <ATag class="m-0">
                {{ D.owner.kind === 'organization' ? $gettext('GitHub organization') : $gettext('Personal account') }}
              </ATag>
              <ATag v-if="D.partner && !D.partner.revoked" color="blue" class="m-0">
                {{ $gettext('Partner') }}
              </ATag>
            </AFlex>
            <ATypographyText type="secondary" class="text-3">
              {{ $gettext('Name, avatar and members come from GitHub') }}
            </ATypographyText>
          </div>
          <AButton :href="D.owner.url || `https://github.com/${login}`" target="_blank">
            <span class="i-tabler-brand-github" />
            {{ D.owner.kind === 'organization' ? $gettext('View organization on GitHub') : $gettext('View account on GitHub') }}
          </AButton>
        </AFlex>
      </ACard>

      <div class="cols">
        <AFlex vertical gap="middle" class="col-main">
          <ACard :title="$gettext('Plugins')">
            <template #extra>
              <span class="text-3 op-65">{{ $gettext('Every plugin of this account in the catalog, with your role from each repository') }}</span>
            </template>
            <AEmpty v-if="!D.plugins.length" :description="$gettext('This account lists no plugin yet.')" />
            <div v-for="plugin in D.plugins" :key="plugin.id" class="row">
              <PluginIcon :src="plugin.iconUrl" :name="localized(plugin.name)" :size="36" />
              <div class="min-w-0 flex-1">
                <AFlex align="center" gap="6" wrap>
                  <span class="font-600">{{ localized(plugin.name) }}</span>
                  <ATag :color="stateTag(plugin.state).color" class="m-0">
                    {{ stateTag(plugin.state).text }}
                  </ATag>
                  <ATag v-if="trustLabel(plugin.trust)" class="m-0">
                    {{ trustLabel(plugin.trust) }}
                  </ATag>
                </AFlex>
                <div class="mono text-3 op-65">
                  {{ plugin.id }}
                </div>
                <div class="text-3 op-65">
                  {{ plugin.version ? `v${plugin.version}` : '' }}{{ plugin.role ? '' : (plugin.version ? ', ' : '') + $gettext('you have no permission on its repository and can only view it') }}
                </div>
              </div>
              <ATag :color="plugin.role ? 'blue' : 'default'" class="m-0">
                {{ $gettext('Your role: %{role}', { role: plugin.role ? roleLabel(plugin.role) : $gettext('none') }) }}
              </ATag>
              <RouterLink :to="`/plugins/${plugin.id}`">
                <AButton size="small" :disabled="!plugin.role">
                  {{ $gettext('Open') }}
                </AButton>
              </RouterLink>
            </div>
          </ACard>

          <ACard v-if="D.owner.kind === 'organization'" :title="$gettext('Partner')">
            <template v-if="D.partner">
              <ATypographyParagraph class="text-3">
                {{ D.partner.revoked ? $gettext('The partner key of this organization was revoked.') : $gettext('This organization is a partner. Packages signed with its partner key show as verified in Nginx UI.') }}
              </ATypographyParagraph>
              <dl class="kv">
                <dt>{{ $gettext('Partner name') }}</dt>
                <dd class="mono">
                  {{ D.partner.name }}
                </dd>
                <dt>{{ $gettext('Key ID') }}</dt>
                <dd class="mono">
                  {{ D.partner.keyId ?? '—' }}
                </dd>
                <dt>{{ $gettext('Valid until') }}</dt>
                <dd>{{ D.partner.expires ?? $gettext('No end date') }}</dd>
              </dl>
            </template>
            <template v-else>
              <ATypographyParagraph class="text-3">
                {{ $gettext('Partner plugins carry a verified mark and may be commercial. An admin of a plugin repository of the organization applies, and a maintainer confirms it.') }}
              </ATypographyParagraph>
              <AAlert
                v-if="D.application && D.application.state !== 'approved'"
                :type="D.application.state === 'declined' ? 'warning' : 'info'"
                show-icon
                class="mb-3"
                :title="D.application.state === 'declined' ? $gettext('The application was declined: %{reason}', { reason: D.application.reason ?? '' }) : $gettext('Applied %{time}, waiting for a maintainer.', { time: fromNow(D.application.createdAt) })"
              />
              <AFlex align="center" gap="middle" wrap>
                <AButton :disabled="!D.canApply || D.application?.state === 'pending'" @click="openApply">
                  {{ $gettext('Apply to become a partner') }}
                </AButton>
                <span v-if="!D.canApply" class="text-3 op-65">{{ $gettext('Needs admin permission on one of the plugin repositories of the organization') }}</span>
              </AFlex>
            </template>
          </ACard>
        </AFlex>

        <AFlex vertical gap="middle" class="col-side">
          <ACard :title="$gettext('Members and access')">
            <ATypographyParagraph class="text-3">
              {{ $gettext('Members and permissions are managed on GitHub. The Developer Center decides what each person may do from their repository permission.') }}
            </ATypographyParagraph>
            <AFlex vertical gap="6" class="text-3">
              <a v-if="D.accessUrl" :href="D.accessUrl" target="_blank" rel="noopener">
                {{ $gettext('Manage teams and repository access on GitHub') }}
                <span class="i-tabler-external-link" />
              </a>
            </AFlex>
          </ACard>
          <ACard :title="$gettext('My organizations')">
            <div v-for="o in mine.owners" :key="o.login" class="mini-row">
              <AAvatar :size="28" shape="square">
                {{ o.login.slice(0, 2).toUpperCase() }}
              </AAvatar>
              <div class="min-w-0 flex-1">
                <RouterLink :to="`/owners/${o.login}`" class="font-500">
                  {{ o.login }}
                </RouterLink>
                <div class="text-3 op-65">
                  {{ o.kind === 'organization' ? $gettext('GitHub organization') : $gettext('Personal account') }}
                </div>
              </div>
            </div>
            <div v-for="v in mine.vendors" :key="v.id" class="mini-row">
              <AAvatar :size="28" shape="square">
                {{ (v.name ?? '?').slice(0, 2).toUpperCase() }}
              </AAvatar>
              <div class="min-w-0 flex-1">
                <RouterLink :to="`/vendors/${v.id}`" class="font-500">
                  {{ v.name }}
                </RouterLink>
                <div class="text-3 op-65">
                  {{ $gettext('Vendor without a public repository') }}
                </div>
              </div>
            </div>
          </ACard>
        </AFlex>
      </div>

      <AModal v-model:open="applying" :title="$gettext('Apply to become a partner')" :confirm-loading="sending" :ok-text="$gettext('Send the application')" @ok="sendApply">
        <AForm layout="vertical">
          <AFormItem :label="$gettext('Partner name')" :extra="$gettext('Lower case letters, digits and dashes. Partner certificates name it.')" required>
            <AInput v-model:value="form.name" class="mono" />
          </AFormItem>
          <AFormItem :label="$gettext('Display name')" required>
            <AInput v-model:value="form.display_name" :maxlength="80" />
          </AFormItem>
          <AFormItem :label="$gettext('Homepage')">
            <AInput v-model:value="form.homepage_url" placeholder="https://" />
          </AFormItem>
          <AFormItem :label="$gettext('About')">
            <ATextarea v-model:value="form.description" :maxlength="280" :rows="2" show-count />
          </AFormItem>
          <AFormItem :label="$gettext('Partner public key')" :extra="$gettext('A minisign public key kept apart from your plugin keys.')" required>
            <ATextarea v-model:value="form.public_key" class="mono" :rows="2" />
          </AFormItem>
          <AFormItem :label="$gettext('Note to the maintainers')">
            <ATextarea v-model:value="form.note" :rows="2" :maxlength="1000" />
          </AFormItem>
        </AForm>
        <AAlert v-if="error" type="error" show-icon :title="error" />
      </AModal>
    </template>
    <ASkeleton v-else active avatar />
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}

.row + .row {
  border-top: 1px solid var(--portal-border);
}

.mini-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0;
  font-size: 13px;
}

.kv dt {
  opacity: 0.65;
}

.kv dd {
  margin: 0;
}
</style>
