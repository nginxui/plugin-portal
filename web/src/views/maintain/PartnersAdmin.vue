<script setup lang="ts">
import type { PartnerRequest, PartnersAdmin } from '@/api/maintain'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { approveRequest, createVendor, declineRequest, getPartnersAdmin, revokePartner } from '@/api/maintain'
import { useFailure } from '@/lib/feedback'
import { $gettext } from '@/lib/gettext'
import { initials } from '@/lib/labels'
import { fromNow } from '@/lib/time'

// Partners for maintainers (spec 11.5): pending applications and key
// requests, the partner table, new vendors, and revoking a key at once.

const router = useRouter()
const failure = useFailure()
const data = ref<PartnersAdmin | null>(null)
const failed = ref(false)
async function load() {
  try {
    data.value = await getPartnersAdmin()
  }
  catch {
    failed.value = true
  }
}
onMounted(load)

function kindText(r: PartnerRequest) {
  switch (r.kind) {
    case 'application': return $gettext('Partner application')
    case 'key_rotation': return $gettext('Key rotation')
    case 'key_revocation': return $gettext('Key revocation')
    default: return $gettext('Profile change')
  }
}

const busy = ref<string | null>(null)
async function approve(r: PartnerRequest) {
  busy.value = r.id
  try {
    const { change } = await approveRequest(r.id)
    router.push(`/changes/${change}`)
  }
  catch {
    failure()
  }
  finally {
    busy.value = null
  }
}

const declining = ref<PartnerRequest | null>(null)
const declineReason = ref('')
async function decline() {
  if (!declining.value || !declineReason.value.trim())
    return
  try {
    await declineRequest(declining.value.id, declineReason.value.trim())
  }
  catch {
    failure()
    return
  }
  declining.value = null
  declineReason.value = ''
  await load()
}

// A new vendor.
const vendor = ref({ name: '', partner: '', admins: '' })
const vendorError = ref('')
const vendorDone = ref('')
const slugFromName = computed(() => vendor.value.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
// Creating a vendor happens in a dialog.
const vendorOpen = ref(false)
function openVendor() {
  vendorError.value = ''
  vendorDone.value = ''
  vendorOpen.value = true
}

async function addVendor() {
  vendorError.value = ''
  vendorDone.value = ''
  try {
    const result = await createVendor({ name: vendor.value.name.trim(), slug: slugFromName.value, partner: vendor.value.partner || undefined, admins: vendor.value.admins.split(/[\s,]+/).filter(Boolean) })
    vendorDone.value = $gettext('Created with the admins %{list}.', { list: result.admins.join(', ') || $gettext('none') })
    vendor.value = { name: '', partner: '', admins: '' }
    vendorOpen.value = false
    await load()
  }
  catch {
    vendorError.value = $gettext('Give a name. The admins are GitHub usernames.')
  }
}

// Revoking a key.
const revoking = ref(false)
const revokeName = ref<string | undefined>()
const revokeReason = ref('')
function startRevoke(name: string) {
  revokeName.value = name
  revokeReason.value = ''
  revoking.value = true
}

// Keys that run out within a month.
const expiring = computed(() => (data.value?.partners ?? []).filter(p => p.state === 'expiring').length)

async function revoke() {
  if (!revokeName.value || !revokeReason.value.trim())
    return
  try {
    const { change } = await revokePartner(revokeName.value, revokeReason.value.trim())
    revoking.value = false
    router.push(`/changes/${change}`)
  }
  catch {
    failure()
  }
}

const profileUrl = (login: string) => `https://github.com/${login}`

function stateTag(state: string, expires: string | null) {
  switch (state) {
    case 'revoked': return { color: 'error', text: $gettext('Revoked') }
    case 'expired': return { color: 'error', text: $gettext('Expired') }
    case 'expiring': {
      const days = expires ? Math.max(0, Math.ceil((Date.parse(`${expires}T00:00:00Z`) - Date.now()) / 86400000)) : null
      return { color: 'warning', text: days === null ? $gettext('Expires %{date}', { date: expires ?? '' }) : $gettext('Key expires in %{n} days', { n: String(days) }) }
    }
    default: return { color: 'success', text: $gettext('Valid') }
  }
}
</script>

<template>
  <div class="page">
    <AFlex justify="space-between" align="flex-start" gap="middle" wrap>
      <div>
        <h1 class="page-title">
          {{ $gettext('Partner management') }}
        </h1>
        <ATypographyText type="secondary">
          {{ $gettext('Partners sign with a partner key and may list commercial plugins. Their profiles and keys live in the partners folder of the catalog repository.') }}
        </ATypographyText>
      </div>
      <AButton type="primary" @click="openVendor">
        <span class="i-tabler-plus" />{{ $gettext('New vendor') }}
      </AButton>
    </AFlex>
    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The partners could not be loaded.')" />
    <ASkeleton v-if="!data && !failed" active />

    <AFlex v-if="data" vertical gap="middle">
      <div class="stats">
        <div class="stat">
          <span class="text-3 op-65">{{ $gettext('Partners') }}</span>
          <span class="num">{{ data.partners.filter(p => p.state !== 'revoked').length }}</span>
          <span class="text-3 op-65">{{ $gettext('With a valid or expiring key') }}</span>
        </div>
        <div class="stat">
          <span class="text-3 op-65">{{ $gettext('Pending requests') }}</span>
          <span class="num" :class="{ 'c-warn': data.requests.length }">{{ data.requests.length }}</span>
          <span class="text-3 op-65">{{ $gettext('Applications and key rotations') }}</span>
        </div>
        <div class="stat">
          <span class="text-3 op-65">{{ $gettext('Keys expiring soon') }}</span>
          <span class="num" :class="{ 'c-warn': expiring }">{{ expiring }}</span>
          <span class="text-3 op-65">{{ $gettext('Within 30 days') }}</span>
        </div>
        <div class="stat">
          <span class="text-3 op-65">{{ $gettext('Vendors without a repository') }}</span>
          <span class="num">{{ data.vendors.length }}</span>
          <span class="text-3 op-65">{{ $gettext('Members managed here') }}</span>
        </div>
      </div>

      <ACard v-if="data.requests.length" :title="$gettext('Pending requests')">
        <template #extra>
          <ATag color="warning" class="m-0">
            {{ $gettext('%{n} items', { n: String(data.requests.length) }) }}
          </ATag>
        </template>
        <div v-for="r in data.requests" :key="r.id" class="request">
          <AAvatar :size="36" shape="square">
            {{ initials(r.owner ?? r.partner) }}
          </AAvatar>
          <div class="min-w-0 flex-1">
            <AFlex align="center" gap="small" wrap>
              <span class="font-600">{{ r.profile?.display_name ?? r.owner ?? r.partner }}</span>
              <ATag class="m-0">
                {{ r.vendorId ? $gettext('Vendor') : $gettext('GitHub organization') }}
              </ATag>
              <ATag :color="r.kind === 'application' ? 'blue' : 'warning'" class="m-0">
                {{ kindText(r) }}
              </ATag>
            </AFlex>
            <div class="text-3 op-65 mt-1">
              {{ $gettext('Sent by @%{login} %{time}', { login: r.by ?? '', time: fromNow(r.createdAt) }) }}{{ r.keyId ? $gettext(', key ID %{id}', { id: r.keyId }) : '' }}
            </div>
            <div v-if="r.reason" class="text-3 mt-1">
              {{ $gettext('Reason: %{reason}', { reason: r.reason }) }}
            </div>
            <div v-if="r.note" class="text-3 op-65 mt-1">
              {{ r.note }}
            </div>
            <AFlex v-if="r.checks" gap="middle" wrap class="text-3 mt-2">
              <span :class="r.checks.listedPlugins ? 'c-ok' : 'c-warn'">
                <span :class="r.checks.listedPlugins ? 'i-tabler-check' : 'i-tabler-alert-triangle'" />
                {{ $gettext('%{n} plugins listed', { n: String(r.checks.listedPlugins) }) }}
              </span>
              <span v-if="r.checks.createdYear" class="c-ok">
                <span class="i-tabler-check" />
                {{ $gettext('Organization created in %{year}', { year: String(r.checks.createdYear) }) }}
              </span>
              <span :class="r.checks.hasKey ? 'c-ok' : 'c-warn'">
                <span :class="r.checks.hasKey ? 'i-tabler-check' : 'i-tabler-alert-triangle'" />
                {{ r.checks.hasKey ? $gettext('Partner key given') : $gettext('No partner key yet') }}
              </span>
            </AFlex>
          </div>
          <AFlex gap="small">
            <a v-if="r.by" :href="profileUrl(r.by)" target="_blank" rel="noopener">
              <AButton size="small">
                {{ $gettext('Contact the applicant') }}
              </AButton>
            </a>
            <AButton size="small" @click="declining = r">
              {{ $gettext('Decline') }}
            </AButton>
            <AButton size="small" type="primary" :loading="busy === r.id" @click="approve(r)">
              {{ $gettext('Approve the request') }}
            </AButton>
          </AFlex>
        </div>
        <ATypographyParagraph type="secondary" class="text-3 mt-3 mb-0">
          {{ $gettext('Approving opens a pull request in the catalog repository that writes the partner profile and key; it takes effect once merged.') }}
        </ATypographyParagraph>
      </ACard>

      <ACard :title="$gettext('Partners')" :styles="{ body: { padding: 0 } }">
        <template #extra>
          <span class="text-3 op-65">{{ $gettext('%{n} in all', { n: String(data.partners.length) }) }}</span>
        </template>
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>{{ $gettext('Name') }}</th>
                <th>{{ $gettext('Kind') }}</th>
                <th>{{ $gettext('Plugins') }}</th>
                <th>{{ $gettext('Key ID') }}</th>
                <th>{{ $gettext('Valid until') }}</th>
                <th>{{ $gettext('State') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in data.partners" :key="p.name">
                <td>
                  <AFlex align="center" gap="small">
                    <AAvatar :size="24" shape="square">
                      {{ initials(p.displayName) }}
                    </AAvatar>
                    <span class="font-500">{{ p.displayName }}</span>
                  </AFlex>
                </td>
                <td>{{ p.kind === 'vendor' ? $gettext('Vendor without a public repository') : $gettext('GitHub organization') }}</td>
                <td>{{ p.plugins }}</td>
                <td class="mono text-3">
                  {{ p.keyId ?? '—' }}
                </td>
                <td class="nowrap">
                  {{ p.expires ?? '—' }}
                </td>
                <td>
                  <ATag :color="stateTag(p.state, p.expires).color" class="m-0">
                    {{ stateTag(p.state, p.expires).text }}
                  </ATag>
                </td>
                <td class="nowrap text-right">
                  <AButton v-if="p.state !== 'revoked'" size="small" type="text" danger @click="startRevoke(p.name)">
                    {{ $gettext('Revoke the key') }}
                  </AButton>
                </td>
              </tr>
            </tbody>
          </table>
          <AEmpty v-if="!data?.partners.length" class="py-6" :description="$gettext('No partner yet.')" />
        </div>
      </ACard>

      <ACard :title="$gettext('Vendors without a repository')">
        <ATypographyParagraph type="secondary" class="text-3">
          {{ $gettext('Only for vendors without a public repository. A partner with a GitHub organization applies from its organization page, and GitHub decides its members.') }}
        </ATypographyParagraph>
        <AAlert v-if="vendorDone" type="success" show-icon class="mb-3" :title="vendorDone" />
        <div class="vendors">
          <RouterLink v-for="v in data.vendors" :key="v.id" :to="`/vendors/${v.id}`" class="vendor">
            <AAvatar :size="28" shape="square">
              {{ initials(v.name) }}
            </AAvatar>
            <span class="min-w-0 flex-1 truncate">{{ v.name }}</span>
            <span class="text-3 op-65 nowrap">{{ $gettext('%{n} plugins', { n: String(v.plugins) }) }}</span>
          </RouterLink>
        </div>
        <ATypographyText v-if="!data.vendors.length" type="secondary" class="text-3">
          {{ $gettext('No vendors yet.') }}
        </ATypographyText>
      </ACard>
    </AFlex>

    <AModal v-model:open="vendorOpen" :title="$gettext('New vendor')" :ok-text="$gettext('Create')" :cancel-text="$gettext('Cancel')" :ok-button-props="{ disabled: !vendor.name.trim() }" @ok="addVendor">
      <AForm layout="vertical">
        <AFormItem :label="$gettext('Name')" required>
          <AInput v-model:value="vendor.name" :placeholder="$gettext('For example Orbit Labs')" />
        </AFormItem>
        <AFormItem :label="$gettext('Partner name')" :extra="$gettext('The name in partners/, once its key is added.')">
          <AInput v-model:value="vendor.partner" class="mono" :placeholder="slugFromName" />
        </AFormItem>
        <AFormItem :label="$gettext('First admins')" required>
          <AInput v-model:value="vendor.admins" :placeholder="$gettext('GitHub usernames, separated by spaces')" />
        </AFormItem>
      </AForm>
      <ATypographyParagraph type="secondary" class="text-3 mb-0">
        {{ $gettext('Only for vendors without a public repository. A partner with a GitHub organization applies from its organization page, and GitHub decides its members.') }}
      </ATypographyParagraph>
      <AAlert v-if="vendorError" type="error" show-icon class="mt-3" :title="vendorError" />
    </AModal>

    <AModal :open="!!declining" :title="$gettext('Decline the request')" :ok-text="$gettext('Decline')" :ok-button-props="{ danger: true, disabled: !declineReason.trim() }" @ok="decline" @cancel="declining = null">
      <ATextarea v-model:value="declineReason" :rows="3" :maxlength="500" :placeholder="$gettext('Why, shown to the applicant')" />
    </AModal>

    <AModal v-model:open="revoking" :title="$gettext('Revoke a partner key')" :ok-text="$gettext('Revoke')" :ok-button-props="{ danger: true, disabled: !revokeName || !revokeReason.trim() }" @ok="revoke">
      <ATypographyParagraph type="secondary" class="text-3">
        {{ $gettext('Once revoked, every version signed with the key stops installing. A revocation needs no review and is committed to the catalog repository at once.') }}
      </ATypographyParagraph>
      <AForm layout="vertical">
        <AFormItem :label="$gettext('Partner')" required>
          <ASelect v-model:value="revokeName" :options="(data?.partners ?? []).filter(p => p.state !== 'revoked').map(p => ({ value: p.name, label: `${p.displayName} (${p.keyId ?? ''})` }))" />
        </AFormItem>
        <AFormItem :label="$gettext('Reason')" required>
          <ATextarea v-model:value="revokeReason" :rows="3" :maxlength="500" />
        </AFormItem>
      </AForm>
    </AModal>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--portal-card);
  border: 1px solid var(--portal-border);
}

.num {
  font-size: 24px;
  font-weight: 600;
  line-height: 32px;
}

.vendors {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}

.vendor {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  color: inherit;
}

.vendor:hover {
  border-color: var(--portal-primary);
}

.request {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
}

.request + .request {
  border-top: 1px solid var(--portal-border);
}

.table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: 13px;
}

.table th {
  text-align: start;
  font-weight: 500;
  padding: 10px 16px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
}

.table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--portal-border);
}

.nowrap {
  white-space: nowrap;
}

.c-ok {
  color: var(--portal-ok-text);
}

.c-warn {
  color: var(--portal-warn-text);
}
</style>
