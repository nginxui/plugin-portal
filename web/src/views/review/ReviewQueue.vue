<script setup lang="ts">
import type { QueueItem } from '@/api/review'
import { onKeyStroke } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getQueue } from '@/api/review'
import { kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { localized } from '@/lib/labels'
import { waited } from '@/lib/time'
import { useReviewStore } from '@/stores/review'

const router = useRouter()
const reviewStore = useReviewStore()
const items = ref<QueueItem[]>([])
const loading = ref(true)
const failed = ref(false)
const filter = ref<'maintainer' | 'author' | 'all'>('maintainer')
const search = ref('')
const focus = ref(0)
const searchInput = ref<{ focus: () => void } | null>(null)

onMounted(async () => {
  try {
    items.value = (await getQueue()).changes
    reviewStore.count(items.value)
  }
  catch {
    failed.value = true
  }
  finally {
    loading.value = false
  }
})

const count = (waitingOn: string) => items.value.filter(i => i.waitingOn === waitingOn).length

const filters = computed(() => [
  { value: 'maintainer', label: `${$gettext('Waiting for review')} ${count('maintainer')}` },
  { value: 'author', label: `${$gettext('Waiting for the author')} ${count('author')}` },
  { value: 'all', label: $gettext('All in progress') },
])

// High risk first, then the longest waiting.
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value
    .filter(i => filter.value === 'all' || i.waitingOn === filter.value)
    .filter(i => !q || i.pluginId?.toLowerCase().includes(q) || i.author?.toLowerCase().includes(q) || localized(i.entry?.name).toLowerCase().includes(q))
    .sort((a, b) => Number(b.risk === 'high') - Number(a.risk === 'high') || a.updatedAt - b.updatedAt)
})

watch(shown, () => {
  focus.value = Math.min(focus.value, Math.max(shown.value.length - 1, 0))
})

function checkState(item: QueueItem): { tone: string, text: string } {
  if (item.stage === 'checks' && item.waitingOn === 'system' && !item.outcome)
    return { tone: 'run', text: $gettext('Running') }
  if (item.stage === 'checks')
    return { tone: 'fail', text: $gettext('Failed') }
  return { tone: 'ok', text: $gettext('Passed') }
}

function open(item: QueueItem | undefined) {
  if (item)
    router.push(`/review/${item.id}`)
}

const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(?:INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)

onKeyStroke(['j', 'ArrowDown'], (e) => {
  if (typing(e))
    return
  e.preventDefault()
  focus.value = Math.min(focus.value + 1, shown.value.length - 1)
})
onKeyStroke(['k', 'ArrowUp'], (e) => {
  if (typing(e))
    return
  e.preventDefault()
  focus.value = Math.max(focus.value - 1, 0)
})
onKeyStroke('Enter', (e) => {
  if (!typing(e))
    open(shown.value[focus.value])
})
onKeyStroke('/', (e) => {
  if (typing(e))
    return
  e.preventDefault()
  searchInput.value?.focus()
})
</script>

<template>
  <div class="page">
    <div>
      <h1 class="page-title">
        {{ $gettext('Review queue') }}
      </h1>
      <ATypographyText type="secondary">
        {{ $gettext('New listings and changes that need a review, highest risk first.') }}
      </ATypographyText>
    </div>

    <AAlert v-if="failed" type="error" show-icon :title="$gettext('The queue could not be loaded.')" />

    <ACard :loading="loading" :styles="{ body: { padding: 0 } }">
      <div class="toolbar">
        <ASegmented v-model:value="filter" :options="filters" />
        <AInput ref="searchInput" v-model:value="search" class="search" allow-clear :placeholder="$gettext('Plugin ID or author')" :aria-label="$gettext('Search')">
          <template #prefix>
            <span class="i-tabler-search op-50" />
          </template>
        </AInput>
      </div>
      <div class="overflow-x-auto">
        <table class="queue">
          <thead>
            <tr>
              <th>{{ $gettext('Risk') }}</th>
              <th>{{ $gettext('Change') }}</th>
              <th>{{ $gettext('Plugin') }}</th>
              <th>{{ $gettext('Author') }}</th>
              <th>{{ $gettext('Checks') }}</th>
              <th>{{ $gettext('Waiting') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, index) in shown"
              :key="item.id"
              :class="{ focus: index === focus }"
              @click="focus = index"
              @dblclick="open(item)"
            >
              <td class="nowrap">
                <span class="risk" :class="item.risk"><i />{{ item.risk === 'high' ? $gettext('High') : $gettext('Normal') }}</span>
              </td>
              <td class="nowrap">
                <ATag :color="item.kind === 'new_listing' ? 'blue' : 'default'" class="m-0">
                  {{ kindLabel(item.kind) }}
                </ATag>
              </td>
              <td>
                <div class="plugin">
                  <PluginIcon :name="localized(item.entry?.name) || item.pluginId || ''" :size="28" />
                  <div class="min-w-0">
                    <div class="font-600 nowrap">
                      {{ localized(item.entry?.name) || item.pluginId }}
                    </div>
                    <div class="mono text-3 op-65 ellipsis">
                      {{ item.pluginId }}
                    </div>
                  </div>
                </div>
              </td>
              <td class="nowrap">
                @{{ item.author }}
              </td>
              <td class="nowrap">
                <span class="check" :class="checkState(item).tone">{{ checkState(item).text }}</span>
              </td>
              <td class="nowrap">
                <span class="op-75">{{ waited(item.updatedAt) }}</span>
              </td>
              <td class="nowrap text-right">
                <RouterLink :to="`/review/${item.id}`">
                  <AButton size="small" :type="index === focus ? 'primary' : 'default'">
                    {{ $gettext('Review') }}
                  </AButton>
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
        <AEmpty v-if="!loading && shown.length === 0" class="py-8" :description="$gettext('Nothing is waiting here.')" />
      </div>
      <div class="keys">
        <span><kbd>j</kbd><kbd>k</kbd>{{ $gettext('Move') }}</span>
        <span><kbd>↵</kbd>{{ $gettext('Open') }}</span>
        <span><kbd>/</kbd>{{ $gettext('Search') }}</span>
      </div>
    </ACard>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--portal-border);
}

.search {
  width: 220px;
  max-width: 100%;
}

.queue {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 13px;
}

.queue th {
  text-align: left;
  font-weight: 500;
  padding: 10px 16px;
  background: var(--portal-faint);
  border-bottom: 1px solid var(--portal-border);
  white-space: nowrap;
}

.queue td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--portal-border);
  vertical-align: middle;
}

.queue tbody tr {
  cursor: default;
}

.queue tbody tr.focus td {
  background: var(--portal-primary-bg);
}

.queue tbody tr.focus td:first-child {
  box-shadow: inset 3px 0 0 var(--portal-primary);
}

.plugin {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.nowrap {
  white-space: nowrap;
}

.ellipsis {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.risk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.risk i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1677ff;
}

.risk.high i {
  background: #fa541c;
}

.check.ok {
  color: #389e0d;
}

.check.fail {
  color: #cf1322;
}

.check.run {
  opacity: 0.7;
}

:global(html.dark) .check.ok {
  color: #6abe39;
}

:global(html.dark) .check.fail {
  color: #e86e6b;
}

.keys {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 10px 16px;
  font-size: 12px;
  opacity: 0.7;
}

.keys span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

kbd {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  border: 1px solid var(--portal-border-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: center;
}
</style>
