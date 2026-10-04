<script setup lang="ts">
import type { MenuProps } from 'antdv-next'
import { breakpointsAntDesign, useBreakpoints } from '@vueuse/core'
import { computed, h, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useRoute, useRouter } from 'vue-router'
import { $gettext, languages, setLanguage } from '@/lib/gettext'
import { isDark, toggleTheme } from '@/lib/theme'
import { useReviewStore } from '@/stores/review'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const gettext = useGettext()
const isMobile = useBreakpoints(breakpointsAntDesign).smaller('lg')
const drawerOpen = ref(false)

watch(() => route.fullPath, () => {
  drawerOpen.value = false
})

function icon(name: string) {
  return h('span', { class: `${name} text-4` })
}

const reviewStore = useReviewStore()
watch(() => session.isMaintainer, (isMaintainer) => {
  if (isMaintainer)
    reviewStore.refresh()
}, { immediate: true })

function withBadge(label: string, count: number) {
  return count > 0
    ? h('span', { class: 'menu-label' }, [label, h('span', { class: 'menu-badge' }, String(count))])
    : label
}

const menuItems = computed<MenuProps['items']>(() => {
  const items: MenuProps['items'] = [
    { key: '/plugins', icon: icon('i-tabler-layout-grid'), label: $gettext('My plugins') },
    { key: '/submit', icon: icon('i-tabler-plus'), label: $gettext('Submit a plugin') },
    { key: '/owners', icon: icon('i-tabler-building'), label: $gettext('Organizations') },
  ]
  if (session.isMaintainer) {
    items.push({
      type: 'group',
      label: $gettext('Maintenance'),
      children: [
        { key: '/review', icon: icon('i-tabler-inbox'), label: withBadge($gettext('Review queue'), reviewStore.pending) },
      ],
    })
  }
  return items
})

// The menu key whose path the current route starts with, groups included.
const selectedKeys = computed(() => {
  const keys: string[] = []
  for (const item of menuItems.value ?? []) {
    if (item && 'children' in item && item.children)
      keys.push(...item.children.map((child: { key?: unknown } | null) => child && 'key' in child ? String(child.key) : '').filter(Boolean))
    else if (item && 'key' in item)
      keys.push(String(item.key))
  }
  const match = keys.filter(key => route.path.startsWith(key)).sort((a, b) => b.length - a.length)[0]
  return match ? [match] : []
})

function onNavigate(key: string) {
  router.push(key)
}

const languageItems = computed<MenuProps['items']>(() =>
  Object.entries(languages).map(([key, label]) => ({ key, label })),
)

const userItems = computed<MenuProps['items']>(() => [
  { key: 'github', label: $gettext('GitHub profile'), icon: icon('i-tabler-brand-github') },
  { type: 'divider' },
  { key: 'logout', label: $gettext('Sign out'), icon: icon('i-tabler-logout') },
])

function onLanguageMenu({ key }: { key: string | number }) {
  setLanguage(String(key))
}

async function onUserMenu({ key }: { key: string | number }) {
  if (key === 'github' && session.user) {
    window.open(`https://github.com/${session.user.login}`, '_blank', 'noopener')
  }
  else if (key === 'logout') {
    await session.logout()
    router.push('/signin')
  }
}
</script>

<template>
  <ALayout class="min-h-screen">
    <ALayoutSider v-if="!isMobile" :width="220" theme="light" class="sider">
      <SiderNav :items="menuItems" :selected-keys="selectedKeys" @navigate="onNavigate" />
    </ALayoutSider>
    <ADrawer v-else v-model:open="drawerOpen" placement="left" :size="260" :closable="false" :styles="{ body: { padding: 0 } }">
      <SiderNav :items="menuItems" :selected-keys="selectedKeys" @navigate="onNavigate" />
    </ADrawer>
    <ALayout>
      <ALayoutHeader class="header">
        <AButton v-if="isMobile" type="text" class="mr-auto" :aria-label="$gettext('Open menu')" @click="drawerOpen = true">
          <span class="i-tabler-menu-2 text-5" />
        </AButton>
        <ADropdown :menu="{ items: languageItems, selectable: true, selectedKeys: [gettext.current], onClick: onLanguageMenu }">
          <AButton type="text" :aria-label="$gettext('Language')">
            <span class="i-tabler-world text-4" />
            <span v-if="!isMobile">{{ languages[gettext.current] }}</span>
          </AButton>
        </ADropdown>
        <AButton type="text" :aria-label="$gettext('Toggle dark mode')" @click="toggleTheme">
          <span :class="isDark ? 'i-tabler-sun' : 'i-tabler-moon'" class="text-4" />
        </AButton>
        <ADropdown v-if="session.user" :menu="{ items: userItems, onClick: onUserMenu }">
          <AButton type="text" :aria-label="$gettext('Account menu')">
            <AAvatar :src="session.user.avatarUrl ?? undefined" :size="24">
              {{ session.user.login.slice(0, 1).toUpperCase() }}
            </AAvatar>
            <span v-if="!isMobile">{{ session.user.login }}</span>
            <span class="i-tabler-chevron-down text-3" />
          </AButton>
        </ADropdown>
      </ALayoutHeader>
      <ALayoutContent>
        <RouterView />
      </ALayoutContent>
    </ALayout>
  </ALayout>
</template>

<style>
.menu-label {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.menu-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #cf1322;
  color: #fff;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}
</style>

<style scoped>
.sider {
  border-inline-end: 1px solid var(--portal-border);
}

.header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 0 16px;
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--portal-border);
}
</style>
