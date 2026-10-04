<script setup lang="ts">
import type { VendorPage } from '@/api/partners'
import type { Role } from '@/api/plugins'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { addMember, addVendorPlugin, getVendor, keyRequest, removeMember, setCommercial, setMemberRole } from '@/api/partners'
import { getCategories } from '@/api/submit'
import { $gettext } from '@/lib/gettext'
import { HOST_LOCALES } from '@/lib/hostLocales'
import { localized, roleLabel } from '@/lib/labels'
import { localeName } from '@/lib/locales'
import { formatDate } from '@/lib/time'

// A vendor without a public repository (spec 11.4): its commercial plugins,
// their release feeds, the partner key and the members, the only members the
// portal manages itself.

const route = useRoute()
const router = useRouter()
const id = computed(() => Number(route.params.id))
const data = ref<VendorPage | null>(null)
const detail = computed(() => data.value)
const missing = ref(false)
const selectedId = ref<string | null>(null)

async function load() {
  try {
    data.value = await getVendor(id.value)
    if (!selectedId.value || !data.value.plugins.some(p => p.id === selectedId.value))
      selectedId.value = data.value.plugins[0]?.id ?? null
    fillCommercial()
  }
  catch {
    missing.value = true
  }
}
watch(id, load, { immediate: true })

// The loaded page, for slots where the template cannot narrow it.
const D = computed(() => data.value as VendorPage)
const selected = computed(() => detail.value?.plugins.find(p => p.id === selectedId.value) ?? null)
const canPublish = computed(() => detail.value?.role === 'admin' || detail.value?.role === 'publisher')

// Commercial details of the selected plugin.
const commercial = ref<{ license: string, trial_days: number | null, purchase_url: string, pricing: Record<string, string> }>({ license: 'commercial', trial_days: null, purchase_url: '', pricing: {} })
const pricingLocale = ref('en')
function fillCommercial() {
  const c = selected.value?.commercial
  commercial.value = { license: c?.license ?? 'commercial', trial_days: c?.trial_days ?? null, purchase_url: c?.purchase_url ?? '', pricing: { ...(c?.pricing ?? {}) } }
}
watch(selectedId, fillCommercial)
const savingCommercial = ref(false)
const notice = ref('')
async function saveCommercial() {
  if (!selected.value)
    return
  savingCommercial.value = true
  try {
    const { change } = await setCommercial(id.value, selected.value.id, { pricing: commercial.value.pricing, purchase_url: commercial.value.purchase_url, ...(commercial.value.trial_days ? { trial_days: commercial.value.trial_days } : {}), license: commercial.value.license })
    router.push(`/changes/${change}`)
  }
  catch {
    notice.value = $gettext('Check the fields: an English price text and an https purchase link.')
  }
  finally {
    savingCommercial.value = false
  }
}

// A new commercial plugin.
const creating = ref(false)
const newPlugin = ref({ id: '', name: '', releases_url: '', categories: [] as string[], license: 'Proprietary' })
const categories = ref<string[]>([])
const createError = ref('')
async function openCreate() {
  newPlugin.value = { id: '', name: '', releases_url: '', categories: [], license: 'Proprietary' }
  createError.value = ''
  creating.value = true
  if (!categories.value.length)
    categories.value = (await getCategories().catch(() => ({ categories: [] }))).categories
}
async function create() {
  try {
    const { change } = await addVendorPlugin(id.value, { id: newPlugin.value.id.trim(), name: { en: newPlugin.value.name.trim() }, releases_url: newPlugin.value.releases_url.trim(), categories: newPlugin.value.categories, license: newPlugin.value.license })
    creating.value = false
    router.push(`/changes/${change}`)
  }
  catch (e) {
    const code = (e as { code?: string }).code
    createError.value = code === 'taken' ? $gettext('This plugin id belongs to another owner.') : code === 'not_partner' ? $gettext('The vendor has no partner key yet.') : $gettext('Check the fields: a reverse domain id, an English name and an https release feed.')
  }
}

// Members.
const newLogin = ref('')
const newRole = ref<Role>('publisher')
const memberError = ref('')
async function add() {
  memberError.value = ''
  try {
    await addMember(id.value, newLogin.value.trim(), newRole.value)
    newLogin.value = ''
    await load()
  }
  catch (e) {
    memberError.value = (e as { code?: string }).code === 'no_such_user' ? $gettext('There is no GitHub user with this name.') : $gettext('The member could not be added.')
  }
}
async function changeRole(userId: number, role: Role) {
  memberError.value = ''
  try {
    await setMemberRole(id.value, userId, role)
  }
  catch {
    memberError.value = $gettext('A vendor keeps at least one admin.')
  }
  await load()
}
async function remove(userId: number) {
  memberError.value = ''
  try {
    await removeMember(id.value, userId)
  }
  catch {
    memberError.value = $gettext('A vendor keeps at least one admin.')
  }
  await load()
}

// Key requests.
const keyModal = ref<'rotation' | 'revocation' | null>(null)
const keyForm = ref({ public_key: '', reason: '' })
const keyError = ref('')
async function sendKey() {
  if (!keyModal.value)
    return
  keyError.value = ''
  try {
    await keyRequest(id.value, { kind: keyModal.value, ...(keyModal.value === 'rotation' ? { public_key: keyForm.value.public_key } : {}), reason: keyForm.value.reason })
    keyModal.value = null
    keyForm.value = { public_key: '', reason: '' }
    await load()
  }
  catch {
    keyError.value = $gettext('Give a reason, and for a rotation a minisign public key.')
  }
}

const ROLES: Role[] = ['admin', 'publisher', 'translator']
</script>

<template>
  <div class="page">
    <AResult v-if="missing" status="404" :title="$gettext('Vendor not found')" :sub-title="$gettext('You are not a member of this vendor.')" />
    <template v-else-if="detail">
      <ACard>
        <AFlex align="center" gap="middle" wrap>
          <AAvatar :size="56" shape="square">
            {{ (D.vendor.name ?? '?').slice(0, 2).toUpperCase() }}
          </AAvatar>
          <div class="flex-1 min-w-0">
            <AFlex align="center" gap="small" wrap>
              <h1 class="page-title m-0">
                {{ D.vendor.name }}
              </h1>
              <ATag v-if="D.partner && !D.partner.revoked" color="blue" class="m-0">
                {{ $gettext('Partner') }}
              </ATag>
              <ATag v-if="D.plugins.some(p => p.commercial)" color="orange" class="m-0">
                {{ $gettext('Commercial') }}
              </ATag>
            </AFlex>
            <ATypographyText type="secondary" class="text-3">
              {{ $gettext('A vendor whose plugins have no public repository. Its members are managed here.') }}
            </ATypographyText>
          </div>
        </AFlex>
      </ACard>

      <div class="cols">
        <AFlex vertical gap="middle" class="col-main">
          <ACard :title="$gettext('Plugins')">
            <template #extra>
              <AButton type="primary" size="small" :disabled="!canPublish || !D.partner" @click="openCreate">
                <span class="i-tabler-plus" />{{ $gettext('New commercial plugin') }}
              </AButton>
            </template>
            <AEmpty v-if="!D.plugins.length" :description="$gettext('No plugin yet.')" />
            <div v-for="p in D.plugins" :key="p.id" class="row" :class="{ on: p.id === selectedId }" role="button" tabindex="0" @click="selectedId = p.id" @keydown.enter="selectedId = p.id">
              <PluginIcon :name="localized(p.name)" :size="36" />
              <div class="min-w-0 flex-1">
                <AFlex align="center" gap="6" wrap>
                  <span class="font-600">{{ localized(p.name) }}</span>
                  <ATag :color="p.state === 'listed' ? 'success' : 'default'" class="m-0">
                    {{ p.state === 'listed' ? $gettext('Listed') : $gettext('Draft') }}
                  </ATag>
                  <ATag v-if="p.commercial" color="orange" class="m-0">
                    {{ $gettext('Commercial') }}
                  </ATag>
                </AFlex>
                <div class="mono text-3 op-65">
                  {{ p.id }}
                </div>
                <div class="text-3 op-65">
                  {{ p.version ? $gettext('v%{version}, from the vendor feed, store texts hosted by the catalog', { version: p.version }) : $gettext('Waiting for its review') }}
                </div>
              </div>
              <RouterLink :to="`/plugins/${p.id}`" @click.stop>
                <AButton size="small">
                  {{ $gettext('Manage') }}
                </AButton>
              </RouterLink>
            </div>
          </ACard>

          <ACard v-if="selected" :title="$gettext('Commercial details: %{name}', { name: localized(selected.name) })">
            <template #extra>
              <span class="text-3 op-65">{{ $gettext('Shown in the catalog and the Nginx UI marketplace') }}</span>
            </template>
            <AForm layout="vertical">
              <ARow :gutter="16">
                <ACol :xs="24" :md="12">
                  <AFormItem :label="$gettext('License')" required>
                    <ASelect v-model:value="commercial.license" :options="[{ value: 'commercial', label: $gettext('Commercial license') }, { value: 'subscription', label: $gettext('Subscription') }]" />
                  </AFormItem>
                </ACol>
                <ACol :xs="24" :md="12">
                  <AFormItem :label="$gettext('Trial days')">
                    <AInputNumber v-model:value="commercial.trial_days" :min="0" :max="365" class="w-full" />
                  </AFormItem>
                </ACol>
              </ARow>
              <AFormItem :label="$gettext('Price text')" :extra="$gettext('Per language; a language left out shows English.')" required>
                <AFlex gap="small">
                  <ASelect v-model:value="pricingLocale" class="w-36" :options="HOST_LOCALES.map(l => ({ value: l, label: localeName(l) }))" />
                  <AInput v-model:value="commercial.pricing[pricingLocale]" :maxlength="200" :placeholder="pricingLocale === 'en' ? 'From 199 USD per server and year' : commercial.pricing.en" />
                </AFlex>
              </AFormItem>
              <AFormItem :label="$gettext('Purchase link')" required>
                <AInput v-model:value="commercial.purchase_url" placeholder="https://" />
              </AFormItem>
            </AForm>
            <AAlert type="info" show-icon class="mb-3" :title="$gettext('Payment and license checks are yours and the plugin\'s. The catalog only shows these details.')" />
            <AAlert v-if="notice" type="error" show-icon class="mb-3" :title="notice" />
            <AButton type="primary" :loading="savingCommercial" :disabled="!canPublish" @click="saveCommercial">
              {{ $gettext('Submit for review') }}
            </AButton>
          </ACard>
        </AFlex>

        <AFlex vertical gap="middle" class="col-side">
          <ACard v-if="selected" :title="$gettext('Release feed')">
            <template #extra>
              <ATag v-if="selected.feed" :color="selected.feed.ok ? 'success' : 'error'" class="m-0">
                {{ selected.feed.ok ? $gettext('Readable') : $gettext('Unreadable') }}
              </ATag>
            </template>
            <div class="mono text-3 break-all">
              {{ selected.releasesUrl ?? $gettext('No feed yet') }}
            </div>
            <dl v-if="selected.feed" class="kv mt-3">
              <dt>{{ $gettext('Newest in the feed') }}</dt>
              <dd>{{ selected.feed.latest ? `v${selected.feed.latest}` : '—' }}, {{ $gettext('%{n} releases', { n: String(selected.feed.releases) }) }}</dd>
              <dt>{{ $gettext('Listed') }}</dt>
              <dd>{{ selected.listedVersions.length ? selected.listedVersions.map(v => `v${v}`).join(', ') : $gettext('Nothing yet') }}</dd>
              <template v-if="selected.feed.error">
                <dt>{{ $gettext('Error') }}</dt>
                <dd>{{ selected.feed.error }}</dd>
              </template>
            </dl>
            <ATypographyParagraph type="secondary" class="text-3 mt-3 mb-0">
              {{ $gettext('Packages stay on your servers. The catalog verifies each new package once and pins its digest.') }}
            </ATypographyParagraph>
          </ACard>

          <ACard>
            <template #title>
              <span class="i-tabler-key mr-2 op-65" />{{ $gettext('Partner key') }}
            </template>
            <template #extra>
              <ATag v-if="D.partner" :color="D.partner.revoked ? 'error' : 'success'" class="m-0">
                {{ D.partner.revoked ? $gettext('Revoked') : $gettext('Valid') }}
              </ATag>
            </template>
            <template v-if="D.partner">
              <dl class="kv">
                <dt>{{ $gettext('Key ID') }}</dt>
                <dd class="mono">
                  {{ D.partner.keyId ?? '—' }}
                </dd>
                <dt>{{ $gettext('Valid until') }}</dt>
                <dd>{{ D.partner.expires ?? $gettext('No end date') }}</dd>
              </dl>
              <AFlex gap="small" class="mt-3">
                <AButton size="small" :disabled="D.role !== 'admin'" @click="keyModal = 'rotation'">
                  {{ $gettext('Ask for a rotation') }}
                </AButton>
                <AButton size="small" danger :disabled="D.role !== 'admin'" @click="keyModal = 'revocation'">
                  {{ $gettext('Ask for a revocation') }}
                </AButton>
              </AFlex>
              <div v-for="r in D.requests.filter(x => x.state === 'pending')" :key="r.id" class="text-3 op-65 mt-2">
                {{ r.kind === 'key_rotation' ? $gettext('Rotation requested %{date}, waiting for a maintainer', { date: formatDate(r.createdAt) }) : $gettext('Revocation requested %{date}, waiting for a maintainer', { date: formatDate(r.createdAt) }) }}
              </div>
            </template>
            <ATypographyText v-else type="secondary" class="text-3">
              {{ $gettext('A maintainer adds the partner key once the contract is in place.') }}
            </ATypographyText>
          </ACard>

          <ACard :title="$gettext('Members')">
            <template #extra>
              <span class="text-3 op-65">{{ $gettext('Managed by the vendor admins') }}</span>
            </template>
            <div v-for="m in D.members" :key="m.userId" class="member">
              <AAvatar :src="m.avatarUrl ?? undefined" :size="28">
                {{ (m.login ?? '?').slice(0, 1).toUpperCase() }}
              </AAvatar>
              <div class="min-w-0 flex-1">
                <div class="truncate">
                  {{ m.login }}
                </div>
                <div class="text-3 op-65 truncate">
                  {{ m.addedBy ? $gettext('Added by @%{login}', { login: m.addedBy }) : '' }}
                </div>
              </div>
              <ASelect v-if="D.canManage" :value="m.role" size="small" class="w-24 flex-none" :options="ROLES.map(r => ({ value: r, label: roleLabel(r) }))" @change="(v: Role) => changeRole(m.userId, v)" />
              <span v-else class="text-3">{{ roleLabel(m.role) }}</span>
              <AButton v-if="D.canManage" type="text" size="small" :aria-label="$gettext('Remove %{login}', { login: m.login ?? '' })" @click="remove(m.userId)">
                <span class="i-tabler-x" />
              </AButton>
            </div>
            <AFlex v-if="D.canManage" gap="small" class="mt-3">
              <AInput v-model:value="newLogin" size="small" :placeholder="$gettext('GitHub username')" :aria-label="$gettext('GitHub username')" @press-enter="add" />
              <ASelect v-model:value="newRole" size="small" class="w-28" :options="ROLES.map(r => ({ value: r, label: roleLabel(r) }))" />
              <AButton size="small" :disabled="!newLogin.trim()" @click="add">
                <span class="i-tabler-user-plus" />{{ $gettext('Add') }}
              </AButton>
            </AFlex>
            <AAlert v-if="memberError" type="error" show-icon class="mt-3" :title="memberError" />
          </ACard>
        </AFlex>
      </div>

      <AModal v-model:open="creating" :title="$gettext('New commercial plugin')" :ok-text="$gettext('Submit for review')" @ok="create">
        <AForm layout="vertical">
          <AFormItem :label="$gettext('Plugin ID')" :extra="$gettext('A reverse domain id of your company, for example com.example.log-shipper.')" required>
            <AInput v-model:value="newPlugin.id" class="mono" />
          </AFormItem>
          <AFormItem :label="$gettext('Name')" required>
            <AInput v-model:value="newPlugin.name" :maxlength="64" />
          </AFormItem>
          <AFormItem :label="$gettext('Release feed')" :extra="$gettext('A JSON feed of your releases with package links and digests.')" required>
            <AInput v-model:value="newPlugin.releases_url" placeholder="https://" />
          </AFormItem>
          <AFormItem :label="$gettext('Categories')">
            <CategoryPicker v-model="newPlugin.categories" :options="categories" />
          </AFormItem>
          <AFormItem :label="$gettext('License')">
            <AInput v-model:value="newPlugin.license" />
          </AFormItem>
        </AForm>
        <AAlert v-if="createError" type="error" show-icon :title="createError" />
      </AModal>

      <AModal :open="!!keyModal" :title="keyModal === 'rotation' ? $gettext('Ask for a key rotation') : $gettext('Ask for a key revocation')" :ok-text="$gettext('Send')" :ok-button-props="{ danger: keyModal === 'revocation' }" @ok="sendKey" @cancel="keyModal = null">
        <AForm layout="vertical">
          <AFormItem v-if="keyModal === 'rotation'" :label="$gettext('New partner public key')" required>
            <ATextarea v-model:value="keyForm.public_key" class="mono" :rows="2" />
          </AFormItem>
          <AFormItem :label="$gettext('Reason')" required>
            <ATextarea v-model:value="keyForm.reason" :rows="3" :maxlength="500" />
          </AFormItem>
        </AForm>
        <AAlert v-if="keyModal === 'revocation'" type="warning" show-icon class="mb-3" :title="$gettext('Once revoked, every version signed with this key stops installing.')" />
        <AAlert v-if="keyError" type="error" show-icon :title="keyError" />
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
  padding: 12px;
  margin: 0 -12px;
  border-radius: 8px;
  cursor: pointer;
}

.row.on {
  background: var(--portal-primary-bg);
}

.member {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.member + .member {
  border-top: 1px solid var(--portal-border);
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

.break-all {
  word-break: break-all;
}
</style>
