<script setup lang="ts">
import type { Provider, ProviderInput } from '@/api/ai'
import { computed, onMounted, ref } from 'vue'
import { addProvider, getProviders, removeProvider, testProvider, updateProvider } from '@/api/ai'
import { $gettext } from '@/lib/gettext'

// AI providers for drafts in the translation workbench (spec 9). Authors can
// neither see nor change anything here.

const providers = ref<Provider[]>([])
const keyConfigured = ref(true)
const usage = ref({ authors: 0, requests: 0, inputTokens: 0, outputTokens: 0 })
const loading = ref(true)
const selectedId = ref<number | 'new' | null>(null)

async function load() {
  loading.value = true
  try {
    const data = await getProviders()
    providers.value = data.providers
    keyConfigured.value = data.keyConfigured
    usage.value = data.today
    if (selectedId.value === null && data.providers.length)
      select(data.providers[0])
  }
  finally {
    loading.value = false
  }
}
onMounted(load)

const form = ref<ProviderInput & { key: string }>({ kind: 'anthropic', name: '', model: '', base_url: '', key: '', daily_quota: 50, enabled: true })
const saving = ref(false)
const error = ref('')
const test = ref<{ ok: boolean, text: string } | null>(null)
const testing = ref(false)

function select(p: Provider) {
  selectedId.value = p.id
  form.value = { kind: p.kind, name: p.name, model: p.model, base_url: p.baseUrl ?? '', key: '', daily_quota: p.dailyQuota, enabled: p.enabled }
  error.value = ''
  test.value = null
}

function create() {
  selectedId.value = 'new'
  form.value = { kind: 'anthropic', name: '', model: '', base_url: '', key: '', daily_quota: 50, enabled: true }
  error.value = ''
  test.value = null
}

const selected = computed(() => providers.value.find(p => p.id === selectedId.value) ?? null)

async function save() {
  saving.value = true
  error.value = ''
  try {
    const input: ProviderInput = { ...form.value, base_url: form.value.base_url || null }
    if (!input.key)
      delete input.key
    if (selectedId.value === 'new') {
      const { id } = await addProvider(input)
      selectedId.value = id
    }
    else if (selectedId.value !== null) {
      await updateProvider(selectedId.value, input)
    }
    form.value.key = ''
    await load()
  }
  catch (e) {
    const code = (e as { code?: string }).code
    error.value = code === 'no_key'
      ? $gettext('The Worker has no key to seal provider keys with yet.')
      : $gettext('Check the fields: a name, a model, a key and, for an OpenAI compatible endpoint, its base URL.')
  }
  finally {
    saving.value = false
  }
}

async function makeDefault(p: Provider) {
  await updateProvider(p.id, { is_default: true })
  await load()
}

async function remove() {
  if (typeof selectedId.value !== 'number')
    return
  await removeProvider(selectedId.value)
  selectedId.value = null
  await load()
}

async function runTest() {
  if (typeof selectedId.value !== 'number')
    return
  testing.value = true
  try {
    const result = await testProvider(selectedId.value)
    test.value = { ok: result.ok, text: result.ok ? $gettext('Connected in %{ms} ms: %{text}', { ms: String(result.ms ?? 0), text: result.text ?? '' }) : (result.message ?? $gettext('The provider did not answer.')) }
  }
  finally {
    testing.value = false
  }
}

const host = (url: string | null, kind: string) => url ? url.replace(/^https:\/\//, '') : kind === 'anthropic' ? 'api.anthropic.com' : ''
</script>

<template>
  <div class="page">
    <AFlex justify="space-between" align="flex-start" gap="middle" wrap>
      <div>
        <h1 class="page-title">
          {{ $gettext('AI models') }}
        </h1>
        <ATypographyText type="secondary">
          {{ $gettext('The models the translation workbench drafts with. Authors can neither see nor change these settings.') }}
        </ATypographyText>
      </div>
      <AButton type="primary" @click="create">
        <span class="i-tabler-plus" />{{ $gettext('Add a model') }}
      </AButton>
    </AFlex>

    <AAlert v-if="!keyConfigured" type="warning" show-icon :title="$gettext('The Worker secret AI_KEY is not set, so provider keys cannot be saved yet.')" />

    <div class="cols">
      <AFlex vertical gap="middle" class="col-main">
        <ACard :loading="loading" :styles="{ body: { padding: 0 } }">
          <div class="overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ $gettext('Name') }}</th>
                  <th>{{ $gettext('Kind') }}</th>
                  <th>{{ $gettext('Model') }}</th>
                  <th>{{ $gettext('Endpoint') }}</th>
                  <th>{{ $gettext('State') }}</th>
                  <th>{{ $gettext('Default') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in providers" :key="p.id" :class="{ on: p.id === selectedId }" role="button" tabindex="0" @click="select(p)" @keydown.enter="select(p)">
                  <td class="font-500">
                    {{ p.name }}
                  </td>
                  <td>{{ p.kind === 'anthropic' ? 'Anthropic' : $gettext('OpenAI compatible') }}</td>
                  <td class="mono">
                    {{ p.model }}
                  </td>
                  <td class="mono text-3">
                    {{ host(p.baseUrl, p.kind) }}
                  </td>
                  <td>
                    <ATag :color="p.enabled ? 'success' : 'default'" class="m-0">
                      {{ p.enabled ? $gettext('On') : $gettext('Off') }}
                    </ATag>
                  </td>
                  <td>
                    <ARadio :checked="p.isDefault" :aria-label="$gettext('Default')" @click.stop="makeDefault(p)" />
                  </td>
                </tr>
              </tbody>
            </table>
            <AEmpty v-if="!loading && !providers.length" class="py-6" :description="$gettext('No model yet. Drafts are off until one is added.')" />
          </div>
        </ACard>

        <ACard v-if="selectedId !== null" :title="selectedId === 'new' ? $gettext('New model') : $gettext('Edit: %{name}', { name: selected?.name ?? '' })">
          <AForm layout="vertical">
            <AFormItem :label="$gettext('Kind')">
              <ASegmented v-model:value="form.kind" :options="[{ value: 'anthropic', label: 'Anthropic' }, { value: 'openai', label: $gettext('OpenAI compatible') }]" />
            </AFormItem>
            <ARow :gutter="16">
              <ACol :xs="24" :md="12">
                <AFormItem :label="$gettext('Name')" required>
                  <AInput v-model:value="form.name" :maxlength="60" />
                </AFormItem>
              </ACol>
              <ACol :xs="24" :md="12">
                <AFormItem :label="$gettext('Model')" required>
                  <AInput v-model:value="form.model" class="mono" :placeholder="form.kind === 'anthropic' ? 'claude-sonnet-5-5' : ''" />
                </AFormItem>
              </ACol>
            </ARow>
            <AFormItem :label="$gettext('Endpoint')" :extra="$gettext('For an OpenAI compatible endpoint, its base URL, for example https://llm.example.com/v1.')">
              <AInput v-model:value="form.base_url" class="mono" :placeholder="form.kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://'" />
            </AFormItem>
            <AFormItem :label="$gettext('API key')" :required="selectedId === 'new'" :extra="$gettext('Kept encrypted and never sent to a browser.')">
              <AInputPassword v-model:value="form.key" :placeholder="selectedId === 'new' ? '' : $gettext('Saved, can only be replaced')" autocomplete="off" />
            </AFormItem>
            <ARow :gutter="16">
              <ACol :xs="24" :md="12">
                <AFormItem :label="$gettext('Drafts per author per day')">
                  <AInputNumber v-model:value="form.daily_quota" :min="0" :max="10000" class="w-full" />
                </AFormItem>
              </ACol>
              <ACol :xs="24" :md="12">
                <AFormItem :label="$gettext('On')">
                  <ASwitch v-model:checked="form.enabled" />
                </AFormItem>
              </ACol>
            </ARow>
          </AForm>
          <AFlex gap="small" align="center" wrap>
            <AButton type="primary" :loading="saving" @click="save">
              {{ $gettext('Save') }}
            </AButton>
            <AButton v-if="typeof selectedId === 'number'" :loading="testing" @click="runTest">
              {{ $gettext('Test the connection') }}
            </AButton>
            <AButton v-if="typeof selectedId === 'number'" danger @click="remove">
              {{ $gettext('Remove') }}
            </AButton>
            <span v-if="test" class="text-3" :class="test.ok ? 'c-ok' : 'c-err'">
              <span :class="test.ok ? 'i-tabler-check' : 'i-tabler-alert-circle'" /> {{ test.text }}
            </span>
          </AFlex>
          <AAlert v-if="error" type="error" show-icon class="mt-3" :title="error" />
        </ACard>
      </AFlex>

      <AFlex vertical gap="middle" class="col-side">
        <ACard :title="$gettext('Today')">
          <dl class="kv">
            <dt>{{ $gettext('Drafts') }}</dt>
            <dd>{{ usage.requests }}</dd>
            <dt>{{ $gettext('Authors') }}</dt>
            <dd>{{ usage.authors }}</dd>
            <dt>{{ $gettext('Tokens in and out') }}</dt>
            <dd>{{ usage.inputTokens }} / {{ usage.outputTokens }}</dd>
          </dl>
        </ACard>
        <ACard :title="$gettext('Glossary')">
          <ATypographyParagraph class="text-3 mb-0">
            {{ $gettext('Taken from the translations of the Nginx UI interface every day, so plugin texts use the words of the host.') }}
          </ATypographyParagraph>
        </ACard>
        <ACard :title="$gettext('Rules')">
          <AFlex vertical gap="8" class="text-3">
            <span><span class="i-tabler-check c-ok" /> {{ $gettext('An AI translation is a draft until an author confirms it.') }}</span>
            <span><span class="i-tabler-check c-ok" /> {{ $gettext('A confirmed name still goes to name review.') }}</span>
            <span><span class="i-tabler-check c-ok" /> {{ $gettext('Past the daily number, an author cannot draft until the next day.') }}</span>
          </AFlex>
        </ACard>
      </AFlex>
    </div>
  </div>
</template>

<style scoped>
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
  cursor: pointer;
}

.table tr.on td {
  background: var(--portal-primary-bg);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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

.c-ok {
  color: #52c41a;
}

.c-err {
  color: #cf1322;
}
</style>
