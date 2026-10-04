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
      <a href="https://nginxui.com/guide/plugins.html" target="_blank" rel="noopener">{{ $gettext('Developer docs') }}</a>
      <a href="https://plugins.nginxui.com" target="_blank" rel="noopener">{{ $gettext('Plugin catalog') }}</a>
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
</style>
