<script setup lang="ts">
import type { PreviewDoc } from './MarketPreview.vue'
import type { CommunityState, Suggestion } from '@/api/community'
import { ref } from 'vue'
import { decide, setCommunity } from '@/api/community'
import { $gettext } from '@/lib/gettext'
import { HOST_LOCALES } from '@/lib/hostLocales'
import { localeName } from '@/lib/locales'

// Community translation of one plugin: the switch, the open languages, the
// suggestions waiting for review and the rolling pull request (spec 9).
const props = defineProps<{ pluginId: string, state: CommunityState, doc: PreviewDoc, storeSource: string }>()
const emit = defineEmits<{ changed: [] }>()

const busy = ref(false)
const error = ref('')
const others = HOST_LOCALES.filter(l => l !== 'en')

async function toggle(enabled: boolean) {
  busy.value = true
  try {
    await setCommunity(props.pluginId, enabled, props.state.locales)
    emit('changed')
  }
  finally {
    busy.value = false
  }
}

const editing = ref(false)
const chosen = ref<string[]>([])
function editLocales() {
  chosen.value = props.state.locales ?? [...others]
  editing.value = true
}
async function saveLocales() {
  busy.value = true
  try {
    await setCommunity(props.pluginId, props.state.enabled, chosen.value.length === others.length ? null : chosen.value)
    editing.value = false
    emit('changed')
  }
  finally {
    busy.value = false
  }
}

function fieldLabel(field: string) {
  if (field === 'name')
    return $gettext('Name')
  if (field === 'description')
    return $gettext('Description')
  const index = (props.doc.screenshots ?? []).findIndex(s => `caption:${s.id}` === field) + 1
  return $gettext('Caption of screenshot %{n}', { n: String(index) })
}

function current(s: Suggestion) {
  if (s.field === 'name' || s.field === 'description')
    return props.doc[s.field]?.[s.locale] ?? ''
  return props.doc.screenshots?.find(sh => `caption:${sh.id}` === s.field)?.caption?.[s.locale] ?? ''
}

const edits = ref<Record<number, string>>({})
const declining = ref<Record<number, string>>({})

async function act(accept: { id: number, text?: string }[], decline: { id: number, reason?: string }[]) {
  busy.value = true
  error.value = ''
  try {
    await decide(props.pluginId, accept, decline)
    for (const a of accept)
      delete edits.value[a.id]
    for (const d of decline)
      delete declining.value[d.id]
    emit('changed')
  }
  catch {
    error.value = $gettext('The decision could not be saved. Please try again.')
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <ACard :title="$gettext('Community translation')">
    <template #extra>
      <ASwitch :checked="state.enabled" :loading="busy" :disabled="!state.canManage" :aria-label="$gettext('Community translation')" @change="(v: boolean) => toggle(v)" />
    </template>
    <ATypographyParagraph v-if="!state.enabled" type="secondary" class="text-3">
      {{ $gettext('When it is on, signed in users can suggest translations of the store texts. You review every suggestion before it goes out.') }}
    </ATypographyParagraph>
    <template v-else>
      <AFlex justify="space-between" align="center" class="text-3 mb-3">
        <span class="op-65">{{ $gettext('Open languages') }}</span>
        <span>
          {{ state.locales ? state.locales.map(localeName).join(', ') : $gettext('All %{n}', { n: String(others.length) }) }}
          <a v-if="state.canManage" class="ml-1" role="button" tabindex="0" @click="editLocales" @keydown.enter="editLocales">{{ $gettext('Edit') }}</a>
        </span>
      </AFlex>

      <div class="font-500 text-3 mb-2">
        {{ $gettext('Waiting for review, %{n}', { n: String(state.pending.length) }) }}
      </div>
      <div v-for="s in state.pending" :key="s.id" class="suggestion">
        <AFlex gap="small" align="center">
          <AAvatar :src="s.avatarUrl ?? undefined" :size="20">
            {{ (s.author ?? '?').slice(0, 1).toUpperCase() }}
          </AAvatar>
          <span class="font-500 text-3">{{ s.author }}</span>
          <span class="text-3 op-65">{{ localeName(s.locale) }}, {{ fieldLabel(s.field) }}</span>
        </AFlex>
        <div class="text-3 mt-2">
          <div class="op-65">
            {{ $gettext('Now: %{text}', { text: current(s) || $gettext('not translated') }) }}
          </div>
          <div v-if="edits[s.id] === undefined">
            {{ $gettext('Suggested: %{text}', { text: s.text }) }}
          </div>
          <AInput v-else v-model:value="edits[s.id]" size="small" class="mt-1" />
        </div>
        <AInput v-if="declining[s.id] !== undefined" v-model:value="declining[s.id]" size="small" class="mt-2" :placeholder="$gettext('Why, shown to the translator')" />
        <AFlex gap="6" wrap class="mt-2">
          <template v-if="declining[s.id] !== undefined">
            <AButton size="small" danger :loading="busy" @click="act([], [{ id: s.id, reason: declining[s.id] }])">
              {{ $gettext('Decline') }}
            </AButton>
            <AButton size="small" @click="delete declining[s.id]">
              {{ $gettext('Cancel') }}
            </AButton>
          </template>
          <template v-else>
            <AButton size="small" type="primary" :loading="busy" @click="act([{ id: s.id, ...(edits[s.id] !== undefined ? { text: edits[s.id] } : {}) }], [])">
              {{ edits[s.id] !== undefined ? $gettext('Accept the edit') : $gettext('Accept') }}
            </AButton>
            <AButton v-if="edits[s.id] === undefined" size="small" @click="edits[s.id] = s.text">
              {{ $gettext('Edit and accept') }}
            </AButton>
            <AButton size="small" @click="declining[s.id] = ''">
              {{ $gettext('Decline') }}
            </AButton>
          </template>
        </AFlex>
      </div>
      <ATypographyText v-if="!state.pending.length" type="secondary" class="text-3">
        {{ $gettext('No suggestions are waiting.') }}
      </ATypographyText>

      <div v-if="state.rolling" class="rolling">
        <AFlex gap="6" align="center" class="font-500 text-3">
          <span class="i-tabler-git-pull-request c-info" />
          {{ state.rolling.prNumber ? $gettext('Community translations, pull request #%{n}', { n: String(state.rolling.prNumber) }) : $gettext('Community translations') }}
        </AFlex>
        <div class="text-3 op-65 mt-1">
          {{ $gettext('%{batches} batches with %{strings} translations, waiting for the merge.', { batches: String(state.rolling.batches), strings: String(state.rolling.strings) }) }}
        </div>
        <AFlex gap="middle" class="mt-1 text-3">
          <a v-if="state.rolling.prUrl" :href="state.rolling.prUrl" target="_blank" rel="noopener">{{ $gettext('View on GitHub') }}</a>
          <RouterLink :to="`/changes/${state.rolling.change}`">
            {{ $gettext('View progress') }}
          </RouterLink>
        </AFlex>
      </div>
      <ATypographyParagraph type="secondary" class="text-3 mt-3 mb-0">
        {{ $gettext('Accepted translations go into one pull request, with the translators as co-authors of each commit.') }}
      </ATypographyParagraph>
    </template>
    <AAlert v-if="error" type="error" show-icon class="mt-3" :title="error" />

    <AModal v-model:open="editing" :title="$gettext('Open languages')" :confirm-loading="busy" :ok-text="$gettext('Save')" :ok-button-props="{ disabled: !chosen.length }" @ok="saveLocales">
      <ACheckboxGroup v-model:value="chosen" class="langs">
        <ACheckbox v-for="l in others" :key="l" :value="l">
          {{ localeName(l) }}
        </ACheckbox>
      </ACheckboxGroup>
    </AModal>
  </ACard>
</template>

<style scoped>
.suggestion {
  padding: 10px 0;
  border-top: 1px solid var(--portal-border);
}

.rolling {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
}

.c-info {
  color: var(--portal-primary);
}

.langs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
</style>
