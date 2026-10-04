<script setup lang="ts">
import type { SubmitDraft } from '@/lib/submitDrafts'
import { computed } from 'vue'
import { checkTitle } from '@/lib/checks'
import { localized } from '@/lib/labels'
import { fromNow } from '@/lib/time'

// A submission started in this browser and not sent yet.

const props = defineProps<{ draft: SubmitDraft }>()

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
      <div class="steps" aria-hidden="true">
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
    </div>
  </section>
</template>

<style scoped>
.pcard {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  background: var(--portal-card);
  min-width: 0;
}

.pcard-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--portal-border);
}

.pcard-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  flex: 1;
}

.pcard-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--portal-border);
}

.steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.steps span {
  height: 4px;
  border-radius: 2px;
  background: var(--portal-border-strong);
}

.steps .done {
  background: var(--portal-primary);
}

.steps .cur {
  background: var(--portal-primary);
  opacity: 0.4;
}

.c-warn {
  color: #d48806;
}
</style>
