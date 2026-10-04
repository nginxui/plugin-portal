<script setup lang="ts">
import type { Installable } from '@/api/plugins'
import type { Preview } from '@/api/submit'
import { useDebounceFn, useMediaQuery } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { getMyPlugins } from '@/api/plugins'
import { checkRepository, getCategories, submitPlugin } from '@/api/submit'
import { categoryLabel } from '@/lib/categories'
import gettext, { $gettext } from '@/lib/gettext'
import { keyState } from '@/lib/keys'
import { localeName } from '@/lib/locales'
import { loadDrafts, rememberDraft } from '@/lib/submitDrafts'

const route = useRoute()
const router = useRouter()

const step = ref(0)
const repos = ref<Installable[]>([])
const installUrl = ref('')
const loadingRepos = ref(true)
const categories = ref<string[]>([])

const checking = ref<string | null>(null)
const checkFailed = ref(false)
const preview = ref<Preview | null>(null)

const publicKey = ref('')
const guideOpen = ref(false)
const checksOpen = ref(true)
const previewMode = ref<'card' | 'detail'>('card')
const chosen = ref<string[]>([])
const submitting = ref(false)
const submitError = ref('')

const draft = computed(() => preview.value?.draft ?? null)
const translations = computed(() => Object.entries(draft.value?.name ?? {}).filter(([locale]) => locale !== 'en'))
const keyLine = computed(() => publicKey.value.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('untrusted comment:')).at(-1) ?? '')
const key = computed(() => keyState(publicKey.value, draft.value?.signer ?? null))
// A key that did not issue the release's certificate would fail the checks
// of the catalog, so it stops here.
const keyLooksValid = computed(() => key.value.state === 'match' || key.value.state === 'unchecked')
// A release without a certificate means the keys were never made.
const keyReady = computed(() => key.value.state === 'match' && draft.value?.signer?.pluginId === draft.value?.id)
// Warnings first, so the ones worth a look lead the list.
const sortedChecks = computed(() => [...(preview.value?.checks ?? [])].sort((a, b) => Number(b.status === 'warn') - Number(a.status === 'warn')))
const warnings = computed(() => preview.value?.checks.filter(c => c.status === 'warn').length ?? 0)
const checkTone = computed(() => warnings.value ? 'warn' : 'ok')
const checkSummary = computed(() => {
  const total = String(preview.value?.checks.length ?? 0)
  return warnings.value
    ? $gettext('%{total} checks passed, %{n} with a warning', { total, n: String(warnings.value) })
    : $gettext('All %{total} checks passed', { total })
})
// A warning is worth a look before submitting, so the list opens for it.
watch(step, (value) => {
  if (value === 2)
    checksOpen.value = true
})

// Keep a started submission with the account so it can be continued later,
// on any device.
let sent = false
const remember = useDebounceFn(() => {
  const repo = preview.value?.draft?.repo ?? (typeof route.query.repo === 'string' ? route.query.repo : '')
  if (!repo || submitting.value || sent)
    return
  const failed = preview.value?.checks.find(c => c.status === 'fail')
  rememberDraft({
    repo,
    id: preview.value?.draft?.id ?? null,
    name: preview.value?.draft?.name ?? {},
    step: step.value + 1,
    problem: failed ?? null,
    publicKey: publicKey.value,
    categories: chosen.value,
  })
}, 800)
watch([step, preview, publicKey, chosen], remember, { deep: true })

// Picks up the key and categories of a saved draft of the repository.
async function restore(repo: string) {
  const saved = (await loadDrafts().catch(() => [])).find(d => d.repo.toLowerCase() === repo.toLowerCase())
  if (saved?.publicKey && !publicKey.value)
    publicKey.value = saved.publicKey
  if (saved?.categories?.length)
    chosen.value = saved.categories
}
const missingCertificate = computed(() => !draft.value?.signer?.signingKeyId || !draft.value?.signer?.primaryKeyId)

const isNarrow = useMediaQuery('(max-width: 720px)')
const drawerSize = computed(() => isNarrow.value ? '100%' : 640)

const steps = computed(() => [
  { title: $gettext('Choose a repository') },
  { title: $gettext('Fill in the details') },
  { title: $gettext('Check and preview') },
  { title: $gettext('Submit for review') },
])

async function pick(repo: string) {
  checking.value = repo
  checkFailed.value = false
  submitError.value = ''
  try {
    preview.value = await checkRepository(repo)
    chosen.value = [...(preview.value.draft?.categories ?? [])]
    router.replace({ query: { repo: preview.value.draft?.repo ?? repo } })
    await restore(preview.value.draft?.repo ?? repo)
    if (preview.value.ok)
      step.value = 1
  }
  catch {
    checkFailed.value = true
  }
  finally {
    checking.value = null
  }
}

function restart() {
  preview.value = null
  step.value = 0
  router.replace({ query: {} })
}

async function submit() {
  if (!draft.value)
    return
  submitting.value = true
  submitError.value = ''
  try {
    const { change } = await submitPlugin({ repo: draft.value.repo, authorPublicKey: publicKey.value, categories: chosen.value })
    sent = true
    router.push(`/changes/${change}`)
  }
  catch (e) {
    const code = e instanceof ApiError ? e.code : ''
    if (code === 'invalid_key') {
      submitError.value = $gettext('The primary public key is not a minisign public key. Paste the content of primary.pub.')
      step.value = 1
    }
    else {
      submitError.value = code === 'checks_failed'
        ? $gettext('The checks no longer pass. Check the repository again.')
        : $gettext('The submission could not be sent. Please try again.')
    }
  }
  finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const [mine, known] = await Promise.all([getMyPlugins().catch(() => null), getCategories().catch(() => null)])
  repos.value = mine?.installable ?? []
  installUrl.value = mine?.installUrl ?? ''
  categories.value = known?.categories ?? []
  loadingRepos.value = false
  if (typeof route.query.repo === 'string' && route.query.repo)
    pick(route.query.repo)
})
</script>

<template>
  <div class="page">
    <div>
      <h1 class="page-title">
        {{ $gettext('Submit a plugin') }}
      </h1>
      <ATypographyText type="secondary">
        {{ $gettext('Once the checks pass, submit the plugin. It is listed after a maintainer approves it.') }}
      </ATypographyText>
    </div>

    <ACard>
      <ASteps :current="step" :items="steps" :responsive="false" label-placement="vertical" size="small" />
    </ACard>

    <!-- 1. Repository -->
    <div v-if="step === 0" class="cols">
      <ACard :title="$gettext('Choose a repository')" class="col-main">
        <RepoPicker :repos="repos" :loading="loadingRepos" :install-url="installUrl" :checking="checking" @pick="pick" />
        <AAlert v-if="checkFailed" type="error" show-icon class="mt-4" :title="$gettext('The repository could not be checked. Please try again.')" />
      </ACard>
      <ACard v-if="preview && !preview.ok" :title="$gettext('Checks')" class="col-side">
        <template #extra>
          <ATag color="error" class="m-0">
            {{ $gettext('Needs changes') }}
          </ATag>
        </template>
        <div class="mono text-3 op-65 mb-4">
          {{ preview.draft?.repo ?? route.query.repo }}
        </div>
        <CheckList :checks="preview.checks" />
        <ATypographyParagraph type="secondary" class="mt-4 mb-0 text-3">
          {{ $gettext('Fix the problems in the repository or a new release, then choose the repository again.') }}
        </ATypographyParagraph>
      </ACard>
      <ACard v-else :title="$gettext('Before you start')" class="col-side">
        <ul class="tips">
          <li>{{ $gettext('The repository is public and you are its admin.') }}</li>
          <li>{{ $gettext('A GitHub Release with a version tag holds the signed packages of the plugin.') }}</li>
          <li>{{ $gettext('The primary public key from nginx-ui plugin key init is at hand.') }}</li>
        </ul>
        <a href="https://nginxui.com/plugin/signing" target="_blank" rel="noopener" class="text-3">
          {{ $gettext('Signing and trust') }}
          <span class="i-tabler-external-link" />
        </a>
      </ACard>
    </div>

    <!-- 2. Details -->
    <template v-else-if="step === 1 && draft">
      <div class="cols">
        <ACard :title="$gettext('Fill in the details')" class="col-main">
          <div class="chosen">
            <span class="i-tabler-brand-github text-5 op-60" />
            <div class="min-w-0 flex-1">
              <div class="font-600">
                {{ draft.repo }}
              </div>
              <div class="mono text-3 op-65">
                {{ draft.id }}  v{{ draft.version }}
              </div>
            </div>
            <AButton type="link" size="small" @click="restart">
              {{ $gettext('Change') }}
            </AButton>
          </div>
          <AForm layout="vertical" class="mt-6">
            <AFormItem required :extra="$gettext('The content of primary.pub, created with nginx-ui plugin key init. It verifies the signer certificates of your releases.')">
              <template #label>
                <span>{{ $gettext('Primary public key') }}</span>
                <a class="guide-link" role="button" tabindex="0" @click.prevent="guideOpen = true" @keydown.enter.prevent="guideOpen = true">
                  {{ $gettext('How to create the keys') }}
                </a>
              </template>
              <AAlert v-if="missingCertificate" type="warning" show-icon class="mb-3" :title="$gettext('%{tag} has no signer certificate, so the keys of this plugin have not been created yet.', { tag: draft.tag })">
                <template #action>
                  <AButton size="small" @click="guideOpen = true">
                    {{ $gettext('Show the steps') }}
                  </AButton>
                </template>
              </AAlert>
              <ATextarea v-model:value="publicKey" :rows="3" class="mono" placeholder="untrusted comment: minisign public key ...&#10;RW..." :status="key.state === 'empty' || keyLooksValid ? undefined : 'error'" />
            </AFormItem>
            <KeyChain :draft="draft" :public-key="publicKey" />
            <AFormItem :label="$gettext('Categories')">
              <CategoryPicker v-model="chosen" :options="categories" :suggested="draft.categories" />
            </AFormItem>
          </AForm>
          <AAlert v-if="submitError" type="error" show-icon class="mb-4" :title="submitError" />
          <AFlex justify="flex-end" gap="small">
            <AButton @click="restart">
              {{ $gettext('Back') }}
            </AButton>
            <AButton type="primary" :disabled="!keyLooksValid" @click="step = 2">
              {{ $gettext('Next') }}
            </AButton>
          </AFlex>
        </ACard>
        <ACard :title="$gettext('Catalog preview')" class="col-side">
          <ListingCard :draft="draft" :categories="chosen" />
        </ACard>
      </div>
      <ADrawer v-model:open="guideOpen" :title="$gettext('How to create the keys')" placement="right" :size="drawerSize">
        <KeyGuide :draft="draft" :public-key="publicKey" stacked />
      </ADrawer>
    </template>

    <!-- 3. Review -->
    <template v-else-if="step === 2 && draft && preview">
      <div class="checks-banner" :class="checkTone">
        <button type="button" class="checks-summary" :aria-expanded="checksOpen" @click="checksOpen = !checksOpen">
          <span :class="checkTone === 'warn' ? 'i-tabler-alert-triangle-filled' : 'i-tabler-circle-check-filled'" class="summary-icon" />
          <span class="flex-1 min-w-0 text-left">
            <span class="font-500">{{ checkSummary }}</span>
            <span class="block text-3 op-75">{{ $gettext('The packages, their signatures and the signer certificate are verified again in the catalog repository after you submit.') }}</span>
          </span>
          <span class="details-link">
            {{ checksOpen ? $gettext('Hide details') : $gettext('Show details') }}
            <span :class="checksOpen ? 'i-tabler-chevron-up' : 'i-tabler-chevron-down'" />
          </span>
        </button>
        <div v-if="checksOpen" class="checks-detail">
          <CheckList :checks="sortedChecks" />
        </div>
      </div>
      <div class="cols">
        <ACard :title="$gettext('Plugin details')" class="col-main">
          <template #extra>
            <AButton type="link" size="small" @click="step = 1">
              {{ $gettext('Edit') }}
            </AButton>
          </template>
          <dl class="kv">
            <dt>{{ $gettext('Repository') }}</dt>
            <dd>
              <a :href="`https://github.com/${draft.repo}`" target="_blank" rel="noopener">{{ draft.repo }}</a>
            </dd>
            <dt>{{ $gettext('Plugin ID') }}</dt>
            <dd class="mono">
              {{ draft.id }}
            </dd>
            <dt>{{ $gettext('Name') }}</dt>
            <dd>
              <div>{{ draft.name.en }}</div>
              <div v-for="[locale, text] in translations" :key="locale" class="translation">
                <span class="op-65">{{ localeName(locale) }}</span>
                <span>{{ text }}</span>
              </div>
            </dd>
            <dt>{{ $gettext('Version') }}</dt>
            <dd>
              <a :href="draft.releaseUrl" target="_blank" rel="noopener">v{{ draft.version }}</a>
              <span class="op-65 text-3 ml-2">{{ $gettext('%{count} packages', { count: String(draft.packages.length) }) }}</span>
            </dd>
            <dt>{{ $gettext('Categories') }}</dt>
            <dd>
              <AFlex gap="4" wrap>
                <ATag v-for="id in chosen" :key="id" class="m-0">
                  {{ categoryLabel(id) }}
                </ATag>
              </AFlex>
            </dd>
            <template v-if="draft.license">
              <dt>{{ $gettext('License') }}</dt>
              <dd>{{ draft.license }}</dd>
            </template>
            <dt>{{ $gettext('Primary public key') }}</dt>
            <dd>
              <ATooltip :title="keyLine">
                <span class="mono">{{ key.id?.slice(0, 8) }}</span>
              </ATooltip>
              <span v-if="keyReady" class="key-ok"><span class="i-tabler-check" />{{ $gettext('Matches the certificate') }}</span>
            </dd>
          </dl>
        </ACard>

        <AFlex vertical gap="middle" class="col-side">
          <ACard>
            <template #title>
              <span class="i-tabler-eye mr-2 align-[-2px]" />{{ $gettext('Catalog preview') }}
            </template>
            <template #extra>
              <ASegmented v-model:value="previewMode" size="small" :options="[{ value: 'card', label: $gettext('Card') }, { value: 'detail', label: $gettext('Details page') }]" />
            </template>
            <ListingCard v-if="previewMode === 'card'" :draft="draft" :categories="chosen" />
            <MarketPreview
              v-else
              :doc="{ name: draft.name, description: draft.description }"
              :locale="gettext.current"
              :version="draft.version"
              :author="draft.repo.split('/')[0]"
              trust="community"
              :categories="chosen"
              :repository="`https://github.com/${draft.repo}`"
              device="phone"
            />
            <div class="shot-slots mt-4">
              <div v-for="n in 2" :key="n" class="shot-slot">
                {{ $gettext('No screenshot yet') }}
              </div>
            </div>
            <ATypographyParagraph type="secondary" class="mt-4 mb-0 text-3">
              {{ $gettext('Names in every language are reviewed with the submission. The description and screenshots come from plugin.json and update with every release.') }}
            </ATypographyParagraph>
          </ACard>
        </AFlex>
      </div>
      <AAlert v-if="submitError" type="error" show-icon :title="submitError" />
      <div class="footer-bar">
        <ATypographyText type="secondary" class="text-3">
          {{ $gettext('After you submit, a maintainer reviews the plugin. Follow it on the change page, and GitHub notifies you of the review.') }}
        </ATypographyText>
        <AFlex gap="small">
          <AButton @click="step = 1">
            {{ $gettext('Back') }}
          </AButton>
          <AButton type="primary" :loading="submitting" @click="submit">
            {{ $gettext('Submit for review') }}
          </AButton>
        </AFlex>
      </div>
    </template>
  </div>
</template>

<style scoped>
.shot-slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.shot-slot {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 10;
  border: 1px dashed var(--portal-border-strong);
  border-radius: 6px;
  background: var(--portal-faint);
  font-size: 12px;
  opacity: 0.65;
}

.tips {
  margin: 0 0 16px;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.chosen {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--portal-faint);
  border: 1px solid var(--portal-border);
}

.guide-link {
  margin-left: 12px;
  font-size: 12px;
  font-weight: 400;
}

.kv {
  display: grid;
  grid-template-columns: minmax(96px, max-content) 1fr;
  gap: 12px 24px;
  margin: 0;
}

.kv dt {
  opacity: 0.65;
}

.kv dd {
  margin: 0;
  min-width: 0;
}

.translation {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.key-ok {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 10px;
  font-size: 12px;
  color: #389e0d;
}

:global(html.dark) .key-ok {
  color: #6abe39;
}

.checks-banner {
  border-radius: 8px;
  border: 1px solid #b7eb8f;
  background: #f6ffed;
}

.checks-banner.warn {
  border-color: #ffe58f;
  background: #fffbe6;
}

:global(html.dark) .checks-banner {
  border-color: #274916;
  background: #162312;
}

:global(html.dark) .checks-banner.warn {
  border-color: #594214;
  background: #2b2111;
}

.checks-summary {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 18px;
  cursor: pointer;
}

.checks-summary:focus-visible {
  outline: 2px solid var(--portal-primary);
  outline-offset: -2px;
  border-radius: 8px;
}

.summary-icon {
  flex: none;
  font-size: 22px;
  color: #52c41a;
}

.warn .summary-icon {
  color: #faad14;
}

.details-link {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--portal-primary);
}

.checks-detail {
  padding: 4px 18px 18px 52px;
}

.checks-detail :deep(.check-list) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px 24px;
}

.footer-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 24px;
  margin: 0 -24px -24px;
  background: var(--portal-bar);
  border-top: 1px solid var(--portal-border);
  backdrop-filter: blur(8px);
}

@media (max-width: 640px) {
  .kv {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .kv dd {
    margin-bottom: 8px;
  }

  .footer-bar {
    margin: 0 -16px -16px;
    padding: 12px 16px;
  }
}
</style>
