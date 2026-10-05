<script setup lang="ts">
import type { SubmitDraft } from '@/lib/submitDrafts'
import { computed, ref } from 'vue'
import { checkTitle } from '@/lib/checks'
import { localized } from '@/lib/labels'
import { forgetDraft } from '@/lib/submitDrafts'
import { fromNow } from '@/lib/time'

// A submission started in this browser and not sent yet.

const props = defineProps<{ draft: SubmitDraft }>()
const emit = defineEmits<{ discard: [] }>()
const discarding = ref(false)
async function discard() {
  discarding.value = true
  await forgetDraft(props.draft.repo)
  emit('discard')
}

const name = computed(() => localized(props.draft.name) || props.draft.repo.split('/')[1] || props.draft.repo)
const steps = computed(() => [1, 2, 3, 4].map(n => (n < props.draft.step ? 'done' : n === props.draft.step ? 'cur' : '')))
</script>

<template>
  <section class="pcard">
    <div class="pcard-head">
      <PluginIcon :name="name" :size="40" />
      <div class="min-w-0 flex-1">
        <AFlex gap="6" align="center" wrap>
          <span class="font-600">{{ name }}</span>
          <ATag class="m-0">
            {{ $gettext('Draft') }}
          </ATag>
        </AFlex>
        <div class="mono text-3 op-65 ellipsis">
          {{ draft.id ?? draft.repo }}
        </div>
      </div>
    </div>
    <div class="pcard-body">
      <div class="pcard-steps" aria-hidden="true">
        <span v-for="(state, i) in steps" :key="i" :class="state" />
      </div>
      <div class="text-3 op-65">
        {{ $gettext('Step %{n} of 4 of the submission, last edited %{time}', { n: String(Math.max(draft.step - 1, 0)), time: fromNow(draft.at) }) }}
      </div>
      <AFlex v-if="draft.problem" gap="small" align="flex-start" class="text-3">
        <span class="i-tabler-alert-triangle c-warn mt-0.5" />
        <span>{{ checkTitle(draft.problem) }}</span>
      </AFlex>
    </div>
    <div class="pcard-foot">
      <RouterLink :to="{ path: '/submit', query: { repo: draft.repo } }">
        <AButton type="text" size="small">
          {{ $gettext('Continue the submission') }}
        </AButton>
      </RouterLink>
      <AButton type="text" size="small" :loading="discarding" @click="discard">
        {{ $gettext('Discard') }}
      </AButton>
    </div>
  </section>
</template>

<style scoped>
.c-warn {
  color: var(--portal-warn-text);
}
</style>
