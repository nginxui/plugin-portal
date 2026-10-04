<script setup lang="ts">
import type { Release } from '@/api/plugins'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { submitSelfService } from '@/api/plugins'
import { $gettext } from '@/lib/gettext'
import { formatDate } from '@/lib/time'
import { usePluginStore } from '@/stores/plugin'

// One page for versions and one for signers, sharing the confirmation of a
// self service change.
const props = withDefaults(defineProps<{ section?: 'versions' | 'signers' }>(), { section: 'versions' })

const store = usePluginStore()
const router = useRouter()
const detail = computed(() => store.detail!)
const plugin = computed(() => detail.value.plugin)
const canPublish = computed(() => plugin.value.role === 'admin' || plugin.value.role === 'publisher')
const locked = computed(() => !canPublish.value || !!detail.value.pending || !detail.value.listed)

const short = (id: string | null) => id ? id.slice(0, 8) : ''

function statusOf(release: Release): { color: string, text: string } {
  if (release.yankedBy === 'signer')
    return { color: 'error', text: $gettext('Signer revoked') }
  if (release.yanked)
    return { color: 'warning', text: $gettext('Yanked') }
  if (release.prerelease)
    return { color: 'default', text: $gettext('Prerelease') }
  return { color: 'success', text: $gettext('Available') }
}

// Signers of the releases, newest first, with how many releases each signed.
const signers = computed(() => {
  const counts = new Map<string, number>()
  for (const r of detail.value.releases) {
    if (r.signer)
      counts.set(r.signer, (counts.get(r.signer) ?? 0) + 1)
  }
  return [...counts].map(([id, count]) => ({ id, count, revoked: detail.value.revokedSigners.includes(id.toUpperCase()) }))
})

// What stays installable if a signer is revoked.
function leftAfterRevoking(id: string) {
  return detail.value.releases.filter(r => !r.yanked && r.signer !== id).length
}

// Versions picked for one batch: yanked together or restored together, one commit.
const selected = ref<string[]>([])
const selectable = (r: Release) => r.yankedBy !== 'signer'
const toYank = computed(() => selected.value.filter(v => detail.value.releases.some(r => r.version === v && !r.yanked)))
const toRestore = computed(() => selected.value.filter(v => detail.value.releases.some(r => r.version === v && r.yankedBy === 'version')))
const allSelected = computed(() => {
  const all = detail.value.releases.filter(selectable)
  return all.length > 0 && all.every(r => selected.value.includes(r.version))
})

function toggle(version: string, on: boolean) {
  selected.value = on ? [...selected.value, version] : selected.value.filter(v => v !== version)
}

function toggleAll(on: boolean) {
  selected.value = on ? detail.value.releases.filter(selectable).map(r => r.version) : []
}

const target = ref<{ kind: 'yank' | 'unyank' | 'revoke', values: string[] } | null>(null)
const reason = ref('')
const sending = ref(false)
const error = ref('')

const okText = computed(() => {
  const t = target.value
  const many = (t?.values.length ?? 0) > 1
  if (t?.kind === 'unyank')
    return many ? $gettext('Restore versions') : $gettext('Restore version')
  if (t?.kind === 'yank')
    return many ? $gettext('Yank versions') : $gettext('Yank version')
  return $gettext('Revoke signer')
})

function ask(kind: 'yank' | 'unyank' | 'revoke', values: string[]) {
  target.value = { kind, values }
  reason.value = ''
  error.value = ''
}

const modalTitle = computed(() => {
  const t = target.value
  if (!t)
    return ''
  const many = t.values.length > 1
  if (t.kind === 'yank')
    return many ? $gettext('Yank %{n} versions', { n: String(t.values.length) }) : $gettext('Yank v%{version}', { version: t.values[0] })
  if (t.kind === 'unyank')
    return many ? $gettext('Restore %{n} versions', { n: String(t.values.length) }) : $gettext('Restore v%{version}', { version: t.values[0] })
  return $gettext('Revoke signer %{id}', { id: short(t.values[0]) })
})

async function confirm() {
  const t = target.value
  if (!t)
    return
  sending.value = true
  error.value = ''
  try {
    const operations = t.kind === 'yank' ? { yank: t.values } : t.kind === 'unyank' ? { unyank: t.values } : { revoke_signers: t.values }
    const { change } = await submitSelfService(plugin.value.id, operations, reason.value)
    target.value = null
    selected.value = []
    router.push(`/changes/${change}`)
  }
  catch (e) {
    error.value = e instanceof ApiError && e.code === 'busy'
      ? $gettext('Another change of this plugin is in progress.')
      : e instanceof ApiError && e.code === 'no_access'
        ? $gettext('Only publishers and admins of the repository can do this.')
        : $gettext('The change could not be sent. Please try again.')
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <AFlex vertical gap="middle">
    <PendingChange />

    <ACard v-if="props.section === 'versions'" :title="$gettext('Versions')" :styles="{ body: { padding: 0 } }">
      <template #extra>
        <span class="text-3 op-65">{{ $gettext('Yanking and restoring take effect at the next catalog update, usually within minutes') }}</span>
      </template>
      <div v-if="selected.length" class="batch-bar">
        <span class="font-500">{{ $gettext('%{n} versions selected', { n: String(selected.length) }) }}</span>
        <span class="flex-1" />
        <AButton size="small" @click="selected = []">
          {{ $gettext('Clear') }}
        </AButton>
        <AButton v-if="toRestore.length" size="small" @click="ask('unyank', toRestore)">
          {{ $gettext('Restore %{n}', { n: String(toRestore.length) }) }}
        </AButton>
        <AButton v-if="toYank.length" size="small" danger type="primary" @click="ask('yank', toYank)">
          {{ $gettext('Yank %{n}', { n: String(toYank.length) }) }}
        </AButton>
      </div>
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th class="check-col">
                <ACheckbox :checked="allSelected" :disabled="locked" :aria-label="$gettext('Select all versions')" @change="(e: { target: { checked: boolean } }) => toggleAll(e.target.checked)" />
              </th>
              <th>{{ $gettext('Version') }}</th>
              <th>{{ $gettext('Released') }}</th>
              <th>{{ $gettext('Signer') }}</th>
              <th>{{ $gettext('Status') }}</th>
              <th class="text-right">
                {{ $gettext('Actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="release in detail.releases" :key="release.version" :class="{ picked: selected.includes(release.version) }">
              <td class="check-col">
                <ACheckbox
                  v-if="selectable(release)"
                  :checked="selected.includes(release.version)"
                  :disabled="locked"
                  :aria-label="$gettext('Select v%{version}', { version: release.version })"
                  @change="(e: { target: { checked: boolean } }) => toggle(release.version, e.target.checked)"
                />
              </td>
              <td class="font-500">
                <a v-if="release.notesUrl" :href="release.notesUrl" target="_blank" rel="noopener">v{{ release.version }}</a>
                <span v-else>v{{ release.version }}</span>
              </td>
              <td>
                <span class="op-75">{{ formatDate(release.releasedAt) }}</span>
              </td>
              <td class="mono">
                {{ short(release.signer) }}
              </td>
              <td>
                <ATag :color="statusOf(release).color" class="m-0">
                  {{ statusOf(release).text }}
                </ATag>
              </td>
              <td class="text-right">
                <AButton v-if="release.yankedBy === 'version'" size="small" :disabled="locked" @click="ask('unyank', [release.version])">
                  {{ $gettext('Restore') }}
                </AButton>
                <AButton v-else-if="!release.yanked" size="small" danger :disabled="locked" @click="ask('yank', [release.version])">
                  {{ $gettext('Yank') }}
                </AButton>
              </td>
            </tr>
          </tbody>
        </table>
        <AEmpty v-if="detail.releases.length === 0" class="py-8" :description="$gettext('No release yet.')" />
      </div>
    </ACard>

    <ACard v-else :title="$gettext('Signers')">
      <template #extra>
        <span class="text-3 op-65">{{ $gettext('Signing keys certified by your primary key') }}</span>
      </template>
      <AEmpty v-if="signers.length === 0" :description="$gettext('No release names its signer.')" class="my-2" />
      <div v-for="signer in signers" :key="signer.id" class="signer">
        <span class="i-tabler-key op-60 text-5" />
        <div class="flex-1 min-w-0">
          <div class="mono">
            {{ signer.id }}
          </div>
          <div class="text-3 op-65">
            {{ $gettext('Signed %{n} releases', { n: String(signer.count) }) }}
          </div>
        </div>
        <ATag v-if="signer.revoked" color="error" class="m-0">
          {{ $gettext('Revoked') }}
        </ATag>
        <AButton v-else size="small" danger :disabled="locked" @click="ask('revoke', [signer.id])">
          {{ $gettext('Revoke') }}
        </AButton>
      </div>
      <ATypographyParagraph type="secondary" class="mt-3 mb-0 text-3">
        {{ $gettext('Revoke a signer when its signing key leaked or was lost. Restoring a revoked signer needs a maintainer.') }}
      </ATypographyParagraph>
    </ACard>

    <AModal
      :open="!!target"
      :title="modalTitle"
      :confirm-loading="sending"
      :ok-text="okText"
      :ok-button-props="{ danger: target?.kind !== 'unyank' }"
      @ok="confirm"
      @cancel="target = null"
    >
      <template v-if="target">
        <AFlex v-if="target.kind !== 'revoke' && target.values.length > 1" gap="6" wrap class="mb-3">
          <span v-for="v in target.values" :key="v" class="version-chip">v{{ v }}</span>
        </AFlex>
        <p v-if="target.kind === 'yank'">
          {{ target.values.length > 1
            ? $gettext('Once yanked, these versions leave the catalog at its next update and can no longer be installed. All of them are changed in one update, and you can restore them at any time.')
            : $gettext('Once yanked, this version leaves the catalog at its next update and can no longer be installed. You can restore it at any time.') }}
        </p>
        <p v-else-if="target.kind === 'unyank'">
          {{ target.values.length > 1
            ? $gettext('Once restored, these versions return to the catalog together at its next update.')
            : $gettext('Once restored, this version returns to the catalog at its next update.') }}
        </p>
        <template v-else>
          <p>{{ $gettext('Every release this key signed is yanked, and only a maintainer can restore the signer.') }}</p>
          <AAlert v-if="leftAfterRevoking(target.values[0]) === 0" type="warning" show-icon class="mb-3" :title="$gettext('No release would stay installable. Publish a release signed by a new signing key first.')" />
        </template>
        <AForm layout="vertical">
          <AFormItem :label="$gettext('Reason')" :extra="$gettext('Kept with the change, for example: the configuration cannot be read after upgrading, use v1.2.0 instead.')" class="mb-0">
            <ATextarea v-model:value="reason" :rows="3" :maxlength="500" />
          </AFormItem>
        </AForm>
        <AAlert v-if="error" type="error" show-icon class="mt-3" :title="error" />
      </template>
    </AModal>
  </AFlex>
</template>

<style scoped>
.table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: 13px;
}

.table th {
  text-align: left;
  font-weight: 500;
  padding: 10px 16px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
}

.table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--portal-border);
}

.table tbody tr:last-child td {
  border-bottom: 0;
}

.check-col {
  width: 40px;
  padding-right: 0 !important;
}

.table tbody tr.picked td {
  background: var(--portal-primary-bg);
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background: var(--portal-primary-bg);
  border-bottom: 1px solid var(--portal-border);
  font-size: 13px;
}

.version-chip {
  padding: 1px 8px;
  border-radius: 6px;
  border: 1px solid var(--portal-border-strong);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.signer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--portal-border);
}

.signer:last-of-type {
  border-bottom: 0;
}
</style>
