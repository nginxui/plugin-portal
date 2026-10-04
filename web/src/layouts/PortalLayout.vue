<script setup lang="ts">
import type { MenuProps } from 'antdv-next'
import { computed, h, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useRoute, useRouter } from 'vue-router'
import logo from '@/assets/logo.svg'
import { $gettext, languages, setLanguage } from '@/lib/gettext'
import { isDark, toggleTheme } from '@/lib/theme'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const gettext = useGettext()
const collapsed = ref(false)

function icon(name: string) {
  return h('span', { class: `${name} text-4` })
}

const menuItems = computed<MenuProps['items']>(() => {
  const items: MenuProps['items'] = [
    { key: '/plugins', icon: icon('i-tabler-layout-grid'), label: $gettext('My plugins') },
  ]
  return items
})

const selectedKeys = computed(() => {
  const match = menuItems.value?.find(item => item && 'key' in item && route.path.startsWith(String(item.key)))
  return match && 'key' in match ? [String(match.key)] : []
})

function onMenuClick({ key }: { key: string | number }) {
  router.push(String(key))
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
    <ALayoutSider
      v-model:collapsed="collapsed"
      :width="220"
      breakpoint="lg"
      :collapsed-width="0"
      theme="light"
      class="sider"
    >
      <div class="logo">
        <img :src="logo" alt="" width="32" height="32">
        <div>
          <div class="logo-name">
            Nginx UI
          </div>
          <div class="logo-sub">
            {{ $gettext('Developer Center') }}
          </div>
        </div>
      </div>
      <AMenu
        mode="inline"
        :items="menuItems"
        :selected-keys="selectedKeys"
        :styles="{ root: { borderInlineEnd: 'none' } }"
        @click="onMenuClick"
      />
      <div class="sider-foot">
        <a href="https://nginxui.com/guide/plugins.html" target="_blank" rel="noopener">{{ $gettext('Developer docs') }}</a>
        <a href="https://plugins.nginxui.com" target="_blank" rel="noopener">{{ $gettext('Plugin catalog') }}</a>
      </div>
    </ALayoutSider>
    <ALayout>
      <ALayoutHeader class="header">
        <ADropdown :menu="{ items: languageItems, selectable: true, selectedKeys: [gettext.current], onClick: onLanguageMenu }">
          <AButton type="text">
            <span class="i-tabler-world text-4" />
            {{ languages[gettext.current] }}
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
            {{ session.user.login }}
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
  border-inline-end: 1px solid rgba(5, 5, 5, 0.06);
}

.sider :deep(.ant-layout-sider-children) {
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.logo {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
}

.logo-name {
  font-weight: 600;
  font-size: 16px;
  line-height: 20px;
}

.logo-sub {
  font-size: 12px;
  line-height: 16px;
  opacity: 0.65;
}

.sider-foot {
  margin-top: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
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
}
</style>
