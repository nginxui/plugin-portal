<script setup lang="ts">
import type { StoreState } from '@/api/store'
import type { Stress } from '@/lib/market'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { submitStore } from '@/api/store'
import gettext, { $gettext } from '@/lib/gettext'
import { HOST_LOCALES } from '@/lib/hostLocales'
import { localized } from '@/lib/labels'
import { coverageOf, itemLabel } from '@/lib/storeDiff'
import { fromNow } from '@/lib/time'
import { useStoreDraft } from '@/lib/useStoreDraft'
import { usePluginStore } from '@/stores/plugin'

const pluginStore = usePluginStore()
const router = useRouter()
const plugin = computed(() => pluginStore.detail!.plugin)

const draft = useStoreDraft(() => plugin.value.id)
const { state, failed, doc, readme, readmeChanged, source, sourceChanged, items, dirty, savedAt, saving, problems, persist } = draft

const locale = ref(HOST_LOCALES.includes(gettext.current) ? gettext.current : 'en')
const theme = ref<'light' | 'dark'>('light')
const device = ref<'desktop' | 'phone'>('desktop')
const stress = ref<Stress>('off')
const categoriesOpen = ref(false)

watch(() => plugin.value.id, draft.load, { immediate: true })

// The loaded state, for the template once it is known.
const S = computed(() => state.value as StoreState)
const coverage = computed(() => coverageOf(doc.value))
const translated = computed(() => HOST_LOCALES.filter(l => (coverage.value[l] ?? 0) > 0).length)

const onChange = draft.setText
const onReadme = draft.setReadme
const discard = draft.discard

function pickSource(value: typeof source.value) {
  source.value = value
  persist()
}

const locked = computed(() => {
  const out: Record<string, string> = {}
  const overrides = state.value?.overrides ?? {}
  if ('description' in overrides)
    out.description = $gettext('Set in the catalog entry')
  if ('homepage_url' in overrides)
    out.homepage_url = $gettext('Set in the catalog entry')
  if ('screenshots' in overrides)
    out.screenshots = $gettext('Set in the catalog entry')
  if (!state.value?.canEdit.all) {
    out.homepage_url = $gettext('Publishers edit this')
    out.screenshots = $gettext('Publishers edit this')
  }
  return out
})

const sources = computed(() => [
  { value: 'repo-branch' as const, title: $gettext('Repository, following the default branch'), text: $gettext('plugin.store.json in %{repo}, live minutes after it is merged.', { repo: state.value?.repo ?? plugin.value.repo ?? '' }) },
  { value: 'repo-release' as const, title: $gettext('Repository, following releases'), text: $gettext('Goes live with the next release, so screenshots of unreleased features stay off the listing.') },
  { value: 'catalog' as const, title: $gettext('Hosted by the catalog'), text: $gettext('Kept in the catalog repository and live at its next update. For plugins without a public repository.') },
])

const readmeNote = computed(() => source.value === 'catalog'
  ? $gettext('Kept in the catalog')
  : state.value?.source === 'repo-branch' ? $gettext('From the default branch of the repository') : $gettext('From the tag of the listed release'))

// What the listing still lacks.
const suggestions = computed(() => {
  const out: { key: string, text: string, to?: string }[] = []
  const missing = HOST_LOCALES.filter(l => l !== 'en' && !doc.value.description?.[l])
  if (!doc.value.description?.en)
    out.push({ key: 'desc', text: $gettext('There is no English description') })
  else if (missing.length)
    out.push({ key: 'desc-i18n', text: $gettext('No description in %{n} languages', { n: String(missing.length) }), to: 'translations' })
  ;(doc.value.screenshots ?? []).forEach((shot, i) => {
    if (!shot.dark_path)
      out.push({ key: `dark-${shot.id}`, text: $gettext('Screenshot %{n} has no dark version', { n: String(i + 1) }), to: 'screenshots' })
  })
  if (!(doc.value.screenshots ?? []).length)
    out.push({ key: 'shots', text: $gettext('There are no screenshots'), to: 'screenshots' })
  return out
})

const delivery = computed(() => {
  if (source.value === 'catalog')
    return { kind: 'catalog' as const, text: $gettext('Committed to the catalog and live at its next update. Names go to review first.') }
  if (state.value?.delivery.bot)
    return { kind: 'bot' as const, text: $gettext('Opened as a pull request on %{repo}, which you merge on GitHub.', { repo: state.value?.repo ?? '' }) }
  return { kind: 'patch' as const, text: $gettext('You download the files and commit them to %{repo}. The change follows once the default branch holds them.', { repo: state.value?.repo ?? '' }) }
})

const confirming = ref(false)
const submitting = ref(false)
const submitError = ref('')

async function submit() {
  submitting.value = true
  submitError.value = ''
  try {
    const result = await submitStore(plugin.value.id, delivery.value.kind === 'patch' ? 'patch' : 'bot')
    confirming.value = false
    await pluginStore.open(plugin.value.id, true)
    router.push(`/changes/${result.change}`)
  }
  catch (e) {
    const code = e instanceof ApiError ? e.code : ''
    submitError.value = code === 'busy'
      ? $gettext('Another store change of this plugin is in progress.')
      : code === 'invalid'
        ? $gettext('Some texts cannot be listed. Check the names for words such as official.')
        : code === 'missing_media'
          ? $gettext('An uploaded screenshot is missing. Upload it again in the screenshot studio.')
          : $gettext('The change could not be sent. Please try again.')
  }
  finally {
    submitting.value = false
  }
}

const name = computed(() => localized(doc.value.name) || localized(plugin.value.name))
</script>

<template>
  <AFlex vertical gap="middle">
    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The store texts could not be loaded.')" />
    <ASkeleton v-else-if="!state" active />
    <template v-else>
      <AAlert v-if="S.pending" type="info" show-icon :title="$gettext('A store change of this plugin is in progress.')">
        <template #action>
          <RouterLink :to="`/changes/${S.pending}`">
            <AButton size="small">
              {{ $gettext('View progress') }}
            </AButton>
          </RouterLink>
        </template>
      </AAlert>

      <ACard :styles="{ body: { padding: '12px 16px' } }">
        <AFlex justify="space-between" align="center" gap="middle" wrap>
          <AFlex align="center" gap="middle" wrap>
            <LanguagePicker v-model="locale" :coverage="coverage" />
            <span class="text-3 op-65">{{ $gettext('Translated into %{n} of %{total} languages, the others show English', { n: String(translated), total: String(HOST_LOCALES.length) }) }}</span>
          </AFlex>
          <AFlex align="center" gap="small" wrap>
            <ASelect
              v-model:value="stress" class="w-40" :aria-label="$gettext('Stress test')" :options="[
                { value: 'off', label: $gettext('No stress test') },
                { value: 'longest', label: $gettext('Longest language') },
                { value: 'rtl', label: $gettext('Right to left') },
                { value: 'pseudo', label: $gettext('Pseudo localized') },
              ]"
            />
            <ASegmented v-model:value="theme" :options="[{ value: 'light', label: $gettext('Light') }, { value: 'dark', label: $gettext('Dark') }]" />
            <ASegmented v-model:value="device" :options="[{ value: 'desktop', label: $gettext('Desktop') }, { value: 'phone', label: $gettext('Phone') }]" />
          </AFlex>
        </AFlex>
      </ACard>

      <div class="cols">
        <div class="col-main">
          <MarketPreview
            :doc="doc"
            :locale="locale"
            :theme="theme"
            :device="device"
            :stress="stress"
            :images="S.images"
            :manifest="S.manifest"
            :version="S.version"
            :author="plugin.owner?.login ?? null"
            :trust="plugin.trust"
            :categories="plugin.categories"
            :repository="plugin.repo ? `https://github.com/${plugin.repo}` : null"
            :icon-url="plugin.iconUrl"
            :readme="readme"
            :readme-base="S.repo && S.ref && source !== 'catalog' ? `https://raw.githubusercontent.com/${S.repo}/${S.ref}` : null"
            :readme-note="readmeNote"
            :readme-editable="source === 'catalog' && S.canEdit.all"
            :editable="S.canEdit.texts"
            :locked="locked"
            outline
            @change="onChange"
            @readme="onReadme"
            @studio="router.push(`/plugins/${plugin.id}/screenshots`)"
            @categories="categoriesOpen = true"
          />
          <ListCardRow v-if="stress !== 'off'" class="mt-4" :doc="doc" :locale="locale" :stress="stress" :trust="plugin.trust" :theme="theme" />
        </div>

        <AFlex vertical gap="middle" class="col-side">
          <ACard :title="$gettext('Store source')">
            <div class="radios" role="radiogroup" :aria-label="$gettext('Store source')">
              <button
                v-for="option in sources"
                :key="option.value"
                type="button"
                role="radio"
                class="radio-card"
                :class="{ on: source === option.value }"
                :aria-checked="source === option.value"
                :disabled="!S.canEdit.all"
                @click="pickSource(option.value)"
              >
                <span class="dot" />
                <span class="min-w-0">
                  <span class="font-500">{{ option.title }}</span>
                  <ATag v-if="S.source === option.value" class="ml-2 m-0" color="blue">{{ $gettext('Current') }}</ATag>
                  <span class="block text-3 op-65 mt-1">{{ option.text }}</span>
                </span>
              </button>
            </div>
            <AAlert v-if="S.source === 'release'" type="info" class="mt-3" :title="$gettext('The store texts come from the manifest of each release now. Submitting creates the first store document.')" />
            <AAlert v-else-if="sourceChanged" type="warning" class="mt-3" :title="$gettext('Moving the store source is reviewed by a maintainer.')" />
          </ACard>

          <ACard :title="$gettext('Changes to publish')">
            <template #extra>
              <ATag v-if="items.length" class="m-0">
                {{ $gettext('%{n} items', { n: String(items.length + (readmeChanged ? 1 : 0)) }) }}
              </ATag>
            </template>
            <div v-if="items.length || readmeChanged" class="items">
              <div v-for="item in items" :key="item.label" class="item">
                <span :class="item.review ? 'i-tabler-shield-check c-info' : 'i-tabler-bolt c-ok'" />
                <div class="min-w-0">
                  <div>{{ itemLabel(item, doc) }}</div>
                  <div class="text-3 op-65">
                    {{ item.review ? $gettext('Goes to name review after the merge') : $gettext('Live after the merge') }}
                  </div>
                </div>
              </div>
              <div v-if="readmeChanged" class="item">
                <span class="i-tabler-bolt c-ok" />
                <div>README</div>
              </div>
            </div>
            <ATypographyText v-else type="secondary" class="text-3">
              {{ $gettext('Click a text in the preview to change it.') }}
            </ATypographyText>
            <AAlert v-if="problems.length" type="error" class="mt-3" :title="problems.join('; ')" />
            <AFlex vertical gap="small" class="mt-4">
              <AButton type="primary" block :disabled="!dirty || !!S.pending || problems.length > 0" @click="confirming = true">
                <span class="i-tabler-git-pull-request" />
                {{ $gettext('Submit changes') }}
              </AButton>
              <span class="text-3 op-65">{{ delivery.text }}</span>
              <AFlex v-if="savedAt" justify="space-between" class="text-3 op-65">
                <span>{{ saving ? $gettext('Saving the draft') : $gettext('Draft saved %{time}', { time: fromNow(savedAt) }) }}</span>
                <a v-if="dirty" role="button" tabindex="0" @click="discard" @keydown.enter="discard">{{ $gettext('Discard the draft') }}</a>
              </AFlex>
            </AFlex>
          </ACard>

          <ACard v-if="suggestions.length" :title="$gettext('Suggestions')">
            <div class="items">
              <div v-for="s in suggestions" :key="s.key" class="item">
                <span class="i-tabler-alert-triangle c-warn" />
                <div class="min-w-0">
                  <div>{{ s.text }}</div>
                  <RouterLink v-if="s.to" :to="`/plugins/${plugin.id}/${s.to}`" class="text-3">
                    {{ s.to === 'translations' ? $gettext('Add them in the translation workbench') : $gettext('Open the screenshot studio') }}
                  </RouterLink>
                </div>
              </div>
            </div>
          </ACard>
        </AFlex>
      </div>

      <AModal v-model:open="confirming" :title="$gettext('Submit the store changes of %{name}', { name })" :confirm-loading="submitting" :ok-text="delivery.kind === 'patch' ? $gettext('Create the patch') : $gettext('Submit')" @ok="submit">
        <p>{{ delivery.text }}</p>
        <ul class="confirm-list">
          <li v-for="item in items" :key="item.label">
            {{ itemLabel(item, doc) }}<span v-if="item.review" class="op-65">{{ $gettext(', reviewed') }}</span>
          </li>
          <li v-if="readmeChanged">
            README
          </li>
          <li v-if="sourceChanged">
            {{ $gettext('Store source: %{source}', { source: sources.find(s => s.value === source)?.title ?? '' }) }}
          </li>
        </ul>
        <AAlert v-if="submitError" type="error" show-icon class="mt-3" :title="submitError" />
      </AModal>
      <CategoryEditModal v-model:open="categoriesOpen" :plugin-id="plugin.id" :current="plugin.categories" />
    </template>
  </AFlex>
</template>

<style scoped>
.radios {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-card {
  all: unset;
  box-sizing: border-box;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--portal-border-strong);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.radio-card:disabled {
  cursor: default;
  opacity: 0.7;
}

.radio-card:focus-visible {
  outline: 2px solid var(--portal-primary);
}

.radio-card.on {
  border-color: var(--portal-primary);
  background: var(--portal-primary-bg);
}

.dot {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  border-radius: 50%;
  border: 1px solid var(--portal-border-strong);
  background: var(--portal-card);
}

.radio-card.on .dot {
  border: 4px solid var(--portal-primary);
}

.items {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}

.item {
  display: flex;
  gap: 8px;
}

.item > span:first-child {
  flex: none;
  margin-top: 3px;
}

.c-ok {
  color: #52c41a;
}

.c-info {
  color: var(--portal-primary);
}

.c-warn {
  color: #faad14;
}

.confirm-list {
  margin: 0;
  padding-left: 20px;
}
</style>
