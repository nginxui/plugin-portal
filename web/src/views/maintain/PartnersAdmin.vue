<script setup lang="ts">
import type { PartnerRequest, PartnersAdmin } from '@/api/maintain'
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { approveRequest, createVendor, declineRequest, getPartnersAdmin, revokePartner } from '@/api/maintain'
import { $gettext } from '@/lib/gettext'
import { fromNow } from '@/lib/time'

// Partners for maintainers (spec 11.5): pending applications and key
// requests, the partner table, new vendors, and revoking a key at once.

const router = useRouter()
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
  finally {
    busy.value = null
  }
}

const declining = ref<PartnerRequest | null>(null)
const declineReason = ref('')
async function decline() {
  if (!declining.value || !declineReason.value.trim())
    return
  await declineRequest(declining.value.id, declineReason.value.trim())
  declining.value = null
  declineReason.value = ''
  await load()
}

// A new vendor.
const vendor = ref({ name: '', slug: '', partner: '', admins: '' })
const vendorError = ref('')
const vendorDone = ref('')
const slugFromName = computed(() => vendor.value.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
async function addVendor() {
  vendorError.value = ''
  vendorDone.value = ''
  try {
    const result = await createVendor({ name: vendor.value.name.trim(), slug: vendor.value.slug || slugFromName.value, partner: vendor.value.partner || undefined, admins: vendor.value.admins.split(/[\s,]+/).filter(Boolean) })
    vendorDone.value = $gettext('Created with the admins %{list}.', { list: result.admins.join(', ') || $gettext('none') })
    vendor.value = { name: '', slug: '', partner: '', admins: '' }
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
async function revoke() {
  if (!revokeName.value || !revokeReason.value.trim())
    return
  const { change } = await revokePartner(revokeName.value, revokeReason.value.trim())
  revoking.value = false
  router.push(`/changes/${change}`)
}

const vendorName = useTemplateRef<{ focus: () => void }>('vendorName')
const profileUrl = (login: string) => `https://github.com/${login}`

function focusVendor() {
  vendorName.value?.focus()
}

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
      <AButton type="primary" @click="focusVendor">
        <span class="i-tabler-plus" />{{ $gettext('New vendor') }}
      </AButton>
    </AFlex>
    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The partners could not be loaded.')" />
    <ASkeleton v-if="!data && !failed" active />

    <div v-if="data" class="cols">
      <AFlex vertical gap="middle" class="col-main">
        <ACard :title="$gettext('Pending requests')">
          <template #extra>
            <ATag v-if="data.requests.length" color="warning" class="m-0">
              {{ $gettext('%{n} items', { n: String(data.requests.length) }) }}
            </ATag>
          </template>
          <AEmpty v-if="!data.requests.length" :image-style="{ height: '40px' }" :description="$gettext('Nothing is waiting.')" />
          <div v-for="r in data.requests" :key="r.id" class="request">
            <AAvatar :size="36" shape="square">
              {{ (r.owner ?? r.partner).slice(0, 2).toUpperCase() }}
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
                {{ $gettext('Approve') }}
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
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in data.partners" :key="p.name">
                  <td>
                    <AFlex align="center" gap="small">
                      <AAvatar :size="24" shape="square">
                        {{ p.displayName.slice(0, 2).toUpperCase() }}
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
                </tr>
              </tbody>
            </table>
            <AEmpty v-if="!data?.partners.length" class="py-6" :description="$gettext('No partner yet.')" />
          </div>
        </ACard>
      </AFlex>

      <AFlex vertical gap="middle" class="col-side">
        <ACard :title="$gettext('New vendor')">
          <AForm layout="vertical">
            <AFormItem :label="$gettext('Name')" required>
              <AInput ref="vendorName" v-model:value="vendor.name" :placeholder="$gettext('For example Orbit Labs')" />
            </AFormItem>
            <AFormItem :label="$gettext('Partner name')" :extra="$gettext('The name in partners/, once its key is added.')">
              <AInput v-model:value="vendor.partner" class="mono" :placeholder="slugFromName" />
            </AFormItem>
            <AFormItem :label="$gettext('First admins')" required>
              <AInput v-model:value="vendor.admins" :placeholder="$gettext('GitHub usernames, separated by spaces')" />
            </AFormItem>
          </AForm>
          <ATypographyParagraph type="secondary" class="text-3">
            {{ $gettext('Only for vendors without a public repository. A partner with a GitHub organization applies from its organization page, and GitHub decides its members.') }}
          </ATypographyParagraph>
          <AButton type="primary" :disabled="!vendor.name.trim()" @click="addVendor">
            {{ $gettext('Create') }}
          </AButton>
          <AAlert v-if="vendorError" type="error" show-icon class="mt-3" :title="vendorError" />
          <AAlert v-if="vendorDone" type="success" show-icon class="mt-3" :title="vendorDone" />
          <div v-for="v in data?.vendors ?? []" :key="v.id" class="text-3 mt-2">
            <RouterLink :to="`/vendors/${v.id}`">
              {{ v.name }}
            </RouterLink>
            <span class="op-65">{{ $gettext(', %{n} plugins', { n: String(v.plugins) }) }}</span>
          </div>
        </ACard>
        <ACard>
          <template #title>
            <span class="i-tabler-key mr-2 op-65" />{{ $gettext('Revoke a key') }}
          </template>
          <ATypographyParagraph class="text-3">
            {{ $gettext('Once revoked, every version signed with the key stops installing. A revocation needs no review and is committed to the catalog repository at once.') }}
          </ATypographyParagraph>
          <AButton danger size="small" :disabled="!(data?.partners ?? []).some(p => p.state !== 'revoked')" @click="revoking = true">
            {{ $gettext('Choose the key to revoke') }}
          </AButton>
        </ACard>
      </AFlex>
    </div>

    <AModal :open="!!declining" :title="$gettext('Decline the request')" :ok-text="$gettext('Decline')" :ok-button-props="{ danger: true, disabled: !declineReason.trim() }" @ok="decline" @cancel="declining = null">
      <ATextarea v-model:value="declineReason" :rows="3" :maxlength="500" :placeholder="$gettext('Why, shown to the applicant')" />
    </AModal>

    <AModal v-model:open="revoking" :title="$gettext('Revoke a partner key')" :ok-text="$gettext('Revoke')" :ok-button-props="{ danger: true, disabled: !revokeName || !revokeReason.trim() }" @ok="revoke">
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
  color: #389e0d;
}

.c-warn {
  color: #d48806;
}
</style>
