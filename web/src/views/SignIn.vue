<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { signInUrl } from '@/api/session'
import logo from '@/assets/logo.svg'
import { $gettext } from '@/lib/gettext'

const route = useRoute()

const next = computed(() => typeof route.query.next === 'string' ? route.query.next : '/plugins')

const error = computed(() => {
  switch (route.query.error) {
    case 'denied':
      return $gettext('Sign in was cancelled on GitHub.')
    case 'state':
      return $gettext('The sign in request has expired. Please try again.')
    case 'github':
      return $gettext('GitHub could not complete the sign in. Please try again later.')
    default:
      return ''
  }
})

const features = computed(() => [
  {
    icon: 'i-tabler-upload',
    title: $gettext('Submit plugins'),
    text: $gettext('Choose a repository and the release and plugin details are read for you. Preview the listing before you submit.'),
  },
  {
    icon: 'i-tabler-bolt',
    title: $gettext('Manage on your own'),
    text: $gettext('Yank versions, revoke signers and change categories. Saved changes take effect immediately.'),
  },
  {
    icon: 'i-tabler-shield-check',
    title: $gettext('Public review'),
    text: $gettext('New listings and key changes are reviewed by maintainers, and every review is public.'),
  },
])
</script>

<template>
  <main class="signin">
    <ACard class="signin-card">
      <AFlex vertical align="center" gap="large">
        <img :src="logo" alt="" width="56" height="56">
        <AFlex vertical align="center" gap="small">
          <h1 class="m-0 text-6 font-600">
            {{ $gettext('Nginx UI Developer Center') }}
          </h1>
          <ATypographyText type="secondary">
            {{ $gettext('Submit plugins, manage your listings and follow their review.') }}
          </ATypographyText>
        </AFlex>
        <AAlert v-if="error" type="warning" :title="error" show-icon class="w-full" />
        <AButton type="primary" size="large" block :href="signInUrl(next)">
          <span class="i-tabler-brand-github text-5" />
          {{ $gettext('Sign in with GitHub') }}
        </AButton>
        <ATypographyText type="secondary" class="text-3 text-center">
          {{ $gettext('Signing in only confirms your GitHub identity. It grants no write access to your repositories.') }}
        </ATypographyText>
      </AFlex>
    </ACard>
    <div class="features">
      <AFlex v-for="feature in features" :key="feature.title" gap="middle" class="feature">
        <span :class="feature.icon" class="feature-icon" />
        <div>
          <div class="font-600">
            {{ feature.title }}
          </div>
          <ATypographyText type="secondary" class="text-3">
            {{ feature.text }}
          </ATypographyText>
        </div>
      </AFlex>
    </div>
    <AFlex gap="large" class="text-3">
      <a href="https://nginxui.com/guide/plugins.html" target="_blank" rel="noopener">{{ $gettext('Developer docs') }}</a>
      <a href="https://plugins.nginxui.com" target="_blank" rel="noopener">{{ $gettext('Plugin catalog') }}</a>
      <a href="https://nginxui.com" target="_blank" rel="noopener">Nginx UI</a>
    </AFlex>
  </main>
</template>

<style scoped>
.signin {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  padding: 48px 16px;
  box-sizing: border-box;
}

.signin-card {
  width: 100%;
  max-width: 420px;
}

.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 24px;
  width: 100%;
  max-width: 880px;
}

.feature-icon {
  flex: none;
  font-size: 20px;
  width: 40px;
  height: 40px;
  padding: 10px;
  box-sizing: border-box;
  border-radius: 8px;
  color: var(--portal-primary-text);
  background: var(--portal-primary-bg);
}
</style>
