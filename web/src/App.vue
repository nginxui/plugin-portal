<script setup lang="ts">
import { theme } from 'antdv-next'
import enUS from 'antdv-next/locale/en_US'
import zhCN from 'antdv-next/locale/zh_CN'
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { isDark } from '@/lib/theme'

const gettext = useGettext()
const locale = computed(() => gettext.current === 'zh_CN' ? zhCN : enUS)

const themeConfig = computed(() => ({
  algorithm: isDark.value ? theme.darkAlgorithm : theme.defaultAlgorithm,
  components: {
    Layout: {
      headerBg: isDark.value ? '#141414' : '#ffffff',
      siderBg: isDark.value ? '#141414' : '#ffffff',
    },
  },
}))
</script>

<template>
  <AConfigProvider
    :theme="themeConfig"
    :locale="locale"
    :button="{ autoInsertSpace: false }"
  >
    <AApp>
      <RouterView />
    </AApp>
  </AConfigProvider>
</template>
