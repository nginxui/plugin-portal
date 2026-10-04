<script setup lang="ts">
import type { MenuProps } from 'antdv-next'
import logo from '@/assets/logo.svg'
import { $gettext } from '@/lib/gettext'

defineProps<{ items: MenuProps['items'], selectedKeys: string[] }>()
const emit = defineEmits<{ navigate: [key: string] }>()
</script>

<template>
  <div class="sider-nav">
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
      :items="items"
      :selected-keys="selectedKeys"
      :styles="{ root: { borderInlineEnd: 'none' } }"
      @click="({ key }) => emit('navigate', String(key))"
    />
    <div class="sider-foot">
      <a href="https://nginxui.com/guide/plugins.html" target="_blank" rel="noopener" class="foot-link">
        <span class="i-tabler-book" />
        <span class="flex-1">{{ $gettext('Developer docs') }}</span>
        <span class="i-tabler-arrow-up-right foot-out" />
      </a>
      <a href="https://plugins.nginxui.com" target="_blank" rel="noopener" class="foot-link">
        <span class="i-tabler-building-store" />
        <span class="flex-1">{{ $gettext('Plugin catalog') }}</span>
        <span class="i-tabler-arrow-up-right foot-out" />
      </a>
    </div>
  </div>
</template>

<style scoped>
.sider-nav {
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.logo {
  flex: none;
  height: 64px;
  border-bottom: 1px solid var(--portal-border);
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
  flex: none;
  margin-top: auto;
  padding: 8px;
  border-top: 1px solid var(--portal-border);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.foot-link {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 6px 20px;
  border-radius: 6px;
  color: inherit;
  opacity: 0.75;
  transition: background-color 0.2s, opacity 0.2s;
}

.foot-link:hover {
  opacity: 1;
  background: var(--portal-faint);
}

.foot-out {
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.2s;
}

.foot-link:hover .foot-out {
  opacity: 0.6;
}
</style>
