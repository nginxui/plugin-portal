<script setup lang="ts">
import type { NotificationItem } from '@/api/notifications'
import { useIntervalFn } from '@vueuse/core'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getNotifications, markRead } from '@/api/notifications'
import { changePath, kindLabel } from '@/lib/changeKinds'
import { $gettext } from '@/lib/gettext'
import { joinClauses, localized } from '@/lib/labels'
import { fromNow } from '@/lib/time'

// What happened to the user's changes, by others or by the catalog.
const router = useRouter()
const items = ref<NotificationItem[]>([])
const unread = ref(0)
const open = ref(false)

async function load() {
  try {
    const data = await getNotifications()
    items.value = data.items
    unread.value = data.unread
  }
  catch {}
}
onMounted(load)
useIntervalFn(load, 120000)

async function onOpen(value: boolean) {
  open.value = value
  if (value && unread.value) {
    await markRead().catch(() => {})
    unread.value = 0
  }
}

function text(item: NotificationItem): string {
  const who = item.actor ? `@${item.actor}` : $gettext('The catalog')
  switch (item.stage) {
    case 'review': return $gettext('The checks passed and the pull request is open')
    case 'checks': return $gettext('The checks found problems')
    case 'changes_requested': return $gettext('%{who} asked for changes', { who })
    case 'merged': return item.actor ? $gettext('%{who} merged it', { who }) : $gettext('It was merged')
    case 'live': return $gettext('It is live in the catalog')
    case 'rejected': return $gettext('%{who} rejected it', { who })
    case 'reminder': return $gettext('It has waited for you for a while')
    case 'withdrawn': return $gettext('It was withdrawn')
    default: return item.stage
  }
}

function go(item: NotificationItem) {
  open.value = false
  router.push(changePath({ id: item.change, number: item.number }))
}
</script>

<template>
  <APopover :open="open" trigger="click" placement="bottomRight" :arrow="false" @open-change="onOpen">
    <AButton type="text" :aria-label="$gettext('Notifications')">
      <ABadge :count="unread" size="small" :offset="[2, -2]">
        <span class="i-tabler-bell text-4" />
      </ABadge>
    </AButton>
    <template #content>
      <div class="list">
        <div class="head">
          {{ $gettext('Notifications') }}
        </div>
        <button v-for="item in items" :key="item.id" type="button" class="item" :class="{ unread: item.unread }" @click="go(item)">
          <span class="dot" />
          <PluginIcon :src="item.iconUrl" :name="localized(item.name ?? undefined) || item.pluginId || ''" :size="28" />
          <span class="min-w-0 flex-1">
            <span class="block font-500 truncate">{{ joinClauses([localized(item.name ?? undefined) || item.pluginId || '', kindLabel(item.kind)]) }}</span>
            <span class="block text-3">{{ text(item) }}</span>
            <span class="block text-3 op-50">{{ fromNow(item.at) }}</span>
          </span>
        </button>
        <div v-if="!items.length" class="empty">
          {{ $gettext('Nothing new.') }}
        </div>
      </div>
    </template>
  </APopover>
</template>

<style scoped>
.list {
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
}

.head {
  padding: 4px 6px 8px;
  font-weight: 600;
}

.item {
  all: unset;
  box-sizing: border-box;
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.item:hover,
.item:focus-visible {
  background: var(--portal-faint);
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 10px;
  border-radius: 50%;
}

.item.unread .dot {
  background: var(--portal-primary);
}

.empty {
  padding: 24px 6px;
  text-align: center;
  opacity: 0.6;
}
</style>
