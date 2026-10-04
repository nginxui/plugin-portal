<script setup lang="ts">
import type { MenuProps } from 'antdv-next'
import { breakpointsAntDesign, useBreakpoints } from '@vueuse/core'
import { computed, h, ref, watch } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useRoute, useRouter } from 'vue-router'
import { $gettext, languages, setLanguage } from '@/lib/gettext'
import { isDark, toggleTheme } from '@/lib/theme'
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

const menuItems = computed<MenuProps['items']>(() => {
  const items: MenuProps['items'] = [
    { key: '/plugins', icon: icon('i-tabler-layout-grid'), label: $gettext('My plugins') },
    { key: '/submit', icon: icon('i-tabler-plus'), label: $gettext('Submit a plugin') },
    { key: '/owners', icon: icon('i-tabler-building'), label: $gettext('Organizations') },
  ]
  return items
})

const selectedKeys = computed(() => {
  const match = menuItems.value?.find(item => item && 'key' in item && route.path.startsWith(String(item.key)))
  return match && 'key' in match ? [String(match.key)] : []
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
