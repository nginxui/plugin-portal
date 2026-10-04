<script setup lang="ts">
import type { Installable } from '@/api/plugins'
import { computed, ref } from 'vue'
import { $gettext } from '@/lib/gettext'
import { fromNow } from '@/lib/time'
import { useMoreRepos } from '@/lib/useMoreRepos'

const props = defineProps<{ repos: Installable[], loading: boolean, installUrl: string, checking: string | null }>()
const emit = defineEmits<{ pick: [repo: string] }>()

const query = ref('')
const other = ref('')

// Repositories with the app installed come first; the others load on request.
const more = useMoreRepos()
const listed = computed(() => [...props.repos, ...more.shown.value])

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? listed.value.filter(r => r.repo.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)) : listed.value
})

function pickOther() {
  const repo = other.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')
  if (repo)
    emit('pick', repo)
}
</script>

<template>
  <div class="picker">
    <AInput v-if="listed.length > 5" v-model:value="query" allow-clear :placeholder="$gettext('Search repositories')">
      <template #prefix>
        <span class="i-tabler-search op-50" />
      </template>
    </AInput>
    <ASkeleton v-if="loading" active :paragraph="{ rows: 3 }" />
    <div v-else-if="shown.length" class="repo-list">
      <button
        v-for="item in shown"
        :key="item.repo"
        type="button"
        class="repo"
        :disabled="checking !== null"
        @click="emit('pick', item.repo)"
      >
        <span class="i-tabler-brand-github repo-icon" />
        <span class="repo-main">
          <span class="repo-name">{{ item.repo }}</span>
          <span v-if="item.description" class="repo-desc">{{ item.description }}</span>
          <span class="repo-meta">
            <ATag :color="item.source === 'installation' ? 'blue' : 'default'" class="m-0">
              {{ item.source === 'installation' ? $gettext('App installed') : $gettext('Admin') }}
            </ATag>
            <span v-if="item.at">{{ $gettext('Updated %{time}', { time: fromNow(item.at) }) }}</span>
          </span>
        </span>
        <ASpin v-if="checking === item.repo" size="small" />
        <span v-else class="i-tabler-chevron-right repo-go" />
      </button>
    </div>
    <AEmpty v-else :description="query ? $gettext('No repository matches the search.') : $gettext('No repository with the app installed is waiting to be submitted.')" />
    <div v-if="!loading && more.hasMore.value">
      <AButton type="link" class="px-0" :loading="more.loading.value" @click="more.loadMore">
        {{ more.left.value === null ? $gettext('Load other repositories you administer') : $gettext('Load more, %{n} left', { n: String(more.left.value) }) }}
      </AButton>
    </div>
    <AAlert v-if="more.failed.value" type="error" show-icon :title="$gettext('The repositories could not be loaded. Please try again.')" />

    <div class="other">
      <div class="text-3 op-65 mb-2">
        {{ $gettext('Another public repository you administer') }}
      </div>
      <AFlex gap="small">
        <AInput v-model:value="other" :placeholder="$gettext('owner/repository')" class="mono" @press-enter="pickOther" />
        <AButton :disabled="!other.trim() || checking !== null" :loading="checking === other.trim()" @click="pickOther">
          {{ $gettext('Check') }}
        </AButton>
      </AFlex>
      <a :href="installUrl" target="_blank" rel="noopener" class="inline-block mt-3 text-3">
        {{ $gettext('Install the app on another repository') }}
        <span class="i-tabler-external-link" />
      </a>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.repo-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  overflow: hidden;
}

.repo {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--portal-border);
  transition: background 0.15s;
}

.repo:last-child {
  border-bottom: 0;
}

.repo:hover:not(:disabled),
.repo:focus-visible {
  background: var(--portal-primary-bg);
}

.repo:focus-visible {
  outline: 2px solid var(--portal-primary);
  outline-offset: -2px;
}

.repo:disabled {
  cursor: default;
}

.repo-icon {
  flex: none;
  font-size: 22px;
  opacity: 0.6;
}

.repo-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.repo-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.repo-desc {
  font-size: 13px;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.85;
}

.repo-go {
  flex: none;
  opacity: 0.45;
}

.other {
  padding-top: 16px;
  border-top: 1px dashed var(--portal-border);
}
</style>
