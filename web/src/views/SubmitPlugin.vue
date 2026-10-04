<script setup lang="ts">
import type { Installable } from '@/api/plugins'
import type { Preview } from '@/api/submit'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { getMyPlugins } from '@/api/plugins'
import { checkRepository, getCategories, submitPlugin } from '@/api/submit'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { localeName } from '@/lib/locales'

const route = useRoute()
const router = useRouter()

const installable = ref<Installable[]>([])
const categories = ref<string[]>([])
const repo = ref(typeof route.query.repo === 'string' ? route.query.repo : '')
const preview = ref<Preview | null>(null)
const checking = ref(false)
const checkFailed = ref(false)
const publicKey = ref('')
const chosen = ref<string[]>([])
const submitting = ref(false)
const submitError = ref('')

const repoOptions = computed(() => installable.value
  .filter(item => item.repo.toLowerCase().includes(repo.value.trim().toLowerCase()))
  .map(item => ({ value: item.repo, label: item.description ? `${item.repo}  ${item.description}` : item.repo })))
const draft = computed(() => preview.value?.draft ?? null)
const translations = computed(() => Object.entries(draft.value?.name ?? {}).filter(([locale]) => locale !== 'en'))
const canSubmit = computed(() => preview.value?.ok && publicKey.value.trim() !== '' && chosen.value.length <= 3)

async function check() {
  if (!repo.value.trim())
    return
  checking.value = true
  checkFailed.value = false
  submitError.value = ''
  try {
    preview.value = await checkRepository(repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, ''))
    chosen.value = [...(preview.value.draft?.categories ?? [])]
    router.replace({ query: { repo: preview.value.draft?.repo ?? repo.value.trim() } })
  }
  catch {
    checkFailed.value = true
  }
  finally {
    checking.value = false
  }
}

async function submit() {
  if (!draft.value)
    return
  submitting.value = true
  submitError.value = ''
  try {
    const { change } = await submitPlugin({ repo: draft.value.repo, authorPublicKey: publicKey.value, categories: chosen.value })
    router.push(`/changes/${change}`)
  }
  catch (e) {
    const code = e instanceof ApiError ? e.code : ''
    submitError.value = code === 'invalid_key'
      ? $gettext('The primary public key is not a minisign public key. Paste the content of primary.pub.')
      : code === 'checks_failed'
        ? $gettext('The checks no longer pass. Check the repository again.')
        : $gettext('The submission could not be sent. Please try again.')
  }
  finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const [mine, known] = await Promise.all([getMyPlugins().catch(() => null), getCategories().catch(() => null)])
  installable.value = mine?.installable ?? []
  categories.value = known?.categories ?? []
  if (repo.value)
    check()
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

    <ACard :title="$gettext('Repository')">
      <AFlex gap="small" wrap>
        <AAutoComplete
          v-model:value="repo"
          :options="repoOptions"
          :placeholder="$gettext('owner/repository')"
          class="flex-1 min-w-60"
          @keydown.enter="check"
        />
        <AButton type="primary" :loading="checking" :disabled="!repo.trim()" @click="check">
          {{ $gettext('Check') }}
        </AButton>
      </AFlex>
      <ATypographyParagraph type="secondary" class="mt-3 mb-0 text-3">
        {{ $gettext('You need admin permission on the repository. The newest release, its plugin.json and its packages are read from GitHub.') }}
      </ATypographyParagraph>
      <AAlert v-if="checkFailed" type="error" show-icon class="mt-3" :title="$gettext('The repository could not be checked. Please try again.')" />
    </ACard>

    <div v-if="preview" class="cols">
      <AFlex vertical gap="middle" class="col-main">
        <ACard v-if="draft" :title="$gettext('Listing')">
          <AFlex gap="middle" align="center" class="mb-4">
            <PluginIcon :name="draft.name.en || draft.id" :size="48" />
            <div class="min-w-0">
              <div class="text-4 font-600">
                {{ localized(draft.name) }}
              </div>
              <div class="mono text-3 op-65">
                {{ draft.id }}
              </div>
            </div>
          </AFlex>
          <ADescriptions :column="1" size="small">
            <ADescriptionsItem :label="$gettext('Description')">
              {{ draft.description }}
            </ADescriptionsItem>
            <ADescriptionsItem :label="$gettext('Version')">
              <a :href="draft.releaseUrl" target="_blank" rel="noopener">v{{ draft.version }}</a>
            </ADescriptionsItem>
            <ADescriptionsItem v-if="translations.length" :label="$gettext('Name translations')">
              <AFlex vertical>
                <span v-for="[locale, text] in translations" :key="locale">{{ localeName(locale) }}: {{ text }}</span>
              </AFlex>
            </ADescriptionsItem>
            <ADescriptionsItem v-if="draft.license" :label="$gettext('License')">
              {{ draft.license }}
            </ADescriptionsItem>
          </ADescriptions>
          <ATypographyParagraph type="secondary" class="mt-3 mb-0 text-3">
            {{ $gettext('Names in every language are reviewed with the submission.') }}
          </ATypographyParagraph>
        </ACard>

        <ACard v-if="draft" :title="$gettext('Details')">
          <AForm layout="vertical" :required-mark="true">
            <AFormItem :label="$gettext('Primary public key')" required :extra="$gettext('The content of primary.pub, created with nginx-ui plugin key init. It verifies the signer certificates of your releases.')">
              <ATextarea v-model:value="publicKey" :rows="3" class="mono" placeholder="untrusted comment: minisign public key ..." />
            </AFormItem>
            <AFormItem :label="$gettext('Categories')" :extra="$gettext('Up to three. Suggested from the capabilities of the plugin.')">
              <ASelect v-model:value="chosen" mode="multiple" :max-count="3" :options="categories.map(c => ({ value: c, label: c }))" />
            </AFormItem>
          </AForm>
          <AAlert v-if="submitError" type="error" show-icon class="mb-4" :title="submitError" />
          <AButton type="primary" size="large" :disabled="!canSubmit" :loading="submitting" @click="submit">
            {{ $gettext('Submit for review') }}
          </AButton>
        </ACard>
      </AFlex>

      <ACard :title="$gettext('Checks')" class="col-side">
        <template #extra>
          <ATag v-if="preview.ok" color="success" class="m-0">
            {{ $gettext('Passed') }}
          </ATag>
          <ATag v-else color="error" class="m-0">
            {{ $gettext('Needs changes') }}
          </ATag>
        </template>
        <CheckList :checks="preview.checks" />
        <ATypographyParagraph type="secondary" class="mt-4 mb-0 text-3">
          {{ $gettext('After you submit, the packages, their signatures and the signer certificate are verified in the catalog repository.') }}
        </ATypographyParagraph>
      </ACard>
    </div>
  </div>
</template>
