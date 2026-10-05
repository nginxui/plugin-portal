<script setup lang="ts">
import { breakpointsAntDesign, useBreakpoints, useIntervalFn, usePreferredReducedMotion } from '@vueuse/core'
import { computed, ref } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useRoute } from 'vue-router'
import { signInUrl } from '@/api/session'
import logo from '@/assets/logo.svg'
import { $gettext, languages, setLanguage } from '@/lib/gettext'
import { isDark, toggleTheme } from '@/lib/theme'

const route = useRoute()
const gettext = useGettext()
// Wide screens split the page in two; below that the sign in is a sheet under the wall.
const breakpoints = useBreakpoints(breakpointsAntDesign)
const isWide = breakpoints.greaterOrEqual('lg')
const isTablet = breakpoints.greaterOrEqual('sm')

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
    text: $gettext('Yank versions, revoke signers and change categories. The changes take effect within minutes, without a review.'),
  },
  {
    icon: 'i-tabler-shield-check',
    title: $gettext('Public review'),
    text: $gettext('New listings and key changes are reviewed by maintainers, and every review is public.'),
  },
])

// The sheet shows one feature at a time, in turns; with reduced motion, or
// room enough, all of them stand still.
const reducedMotion = usePreferredReducedMotion()
const listFeatures = computed(() => isWide.value || reducedMotion.value === 'reduce')
const active = ref(0)
useIntervalFn(() => {
  if (!listFeatures.value)
    active.value = (active.value + 1) % features.value.length
}, 4500)

// What signing in lets the Developer Center read, so nothing comes as a surprise.
const reads = computed(() => [
  { icon: 'i-tabler-user', text: $gettext('Your public GitHub profile') },
  { icon: 'i-tabler-mail', text: $gettext('Your verified email addresses, for the notifications you turn on') },
  { icon: 'i-tabler-git-branch', text: $gettext('Your role on the repositories of your plugins') },
])
const readsOpen = ref(false)

const languageItems = computed(() => Object.entries(languages).map(([key, label]) => ({ key, label })))
</script>

<template>
  <main class="signin" :class="isWide ? 'wide' : 'narrow'">
    <PluginWall class="wall" :columns="isWide ? 10 : isTablet ? 9 : 6" :rows="isWide ? 16 : 9" :mark="isWide ? 168 : 132" :quiet="isWide ? 3 : 1.8" />

    <div class="controls">
      <ADropdown :menu="{ items: languageItems, selectable: true, selectedKeys: [gettext.current], onClick: ({ key }) => setLanguage(String(key)) }">
        <AButton type="text" :aria-label="$gettext('Language')">
          <span class="i-tabler-world text-4" />
          <span v-if="isWide">{{ languages[gettext.current] }}</span>
        </AButton>
      </ADropdown>
      <AButton type="text" :aria-label="$gettext('Toggle dark mode')" @click="toggleTheme">
        <span :class="isDark ? 'i-tabler-sun' : 'i-tabler-moon'" class="text-4" />
      </AButton>
    </div>

    <section class="sheet">
      <div class="brand step" style="--i: 0">
        <img :src="logo" alt="" width="28" height="28">
        <span>{{ $gettext('Nginx UI Developer Center') }}</span>
      </div>

      <h1 class="headline step" style="--i: 1">
        {{ $gettext('Publish and maintain your Nginx UI plugins') }}
      </h1>

      <ul v-if="listFeatures" class="features">
        <li v-for="(feature, index) in features" :key="feature.title" class="step" :style="{ '--i': index + 2 }">
          <span class="feature-icon"><span :class="feature.icon" /></span>
          <div>
            <div class="feature-title">
              {{ feature.title }}
            </div>
            <div class="feature-text">
              {{ feature.text }}
            </div>
          </div>
        </li>
      </ul>
      <div v-else class="rotator step" style="--i: 2">
        <Transition name="feature" mode="out-in">
          <div :key="active" class="rotator-item">
            <span class="feature-icon"><span :class="features[active].icon" /></span>
            <div>
              <div class="feature-title">
                {{ features[active].title }}
              </div>
              <div class="feature-text">
                {{ features[active].text }}
              </div>
            </div>
          </div>
        </Transition>
        <div class="dots" role="tablist" :aria-label="$gettext('Features')">
          <button
            v-for="(feature, index) in features"
            :key="feature.title"
            type="button"
            role="tab"
            class="dot"
            :class="{ on: index === active }"
            :aria-selected="index === active"
            :aria-label="feature.title"
            @click="active = index"
          />
        </div>
      </div>

      <AAlert v-if="error" type="warning" :title="error" show-icon class="alert step" style="--i: 5" />

      <AButton color="default" variant="solid" size="large" block :href="signInUrl(next)" class="github step" style="--i: 5">
        <span class="i-tabler-brand-github text-5" />
        {{ $gettext('Sign in with GitHub') }}
      </AButton>

      <div class="trust step" style="--i: 6">
        <div class="safe">
          <span class="i-tabler-lock" />
          <span>{{ $gettext('Signing in grants no write access to your repositories.') }}</span>
        </div>
        <button type="button" class="reads-toggle" :aria-expanded="readsOpen" @click="readsOpen = !readsOpen">
          {{ $gettext('After you sign in, the Developer Center reads') }}
          <span :class="readsOpen ? 'i-tabler-chevron-up' : 'i-tabler-chevron-down'" />
        </button>
        <Transition name="reads">
          <ul v-if="readsOpen" class="reads">
            <li v-for="item in reads" :key="item.icon">
              <span :class="item.icon" />
              <span>{{ item.text }}</span>
            </li>
          </ul>
        </Transition>
      </div>

      <nav class="links step" style="--i: 7">
        <a href="https://nginxui.com/guide/plugins.html" target="_blank" rel="noopener">{{ $gettext('Developer docs') }}</a>
        <a href="https://plugins.nginxui.com" target="_blank" rel="noopener">{{ $gettext('Plugin catalog') }}</a>
        <a href="https://github.com/nginxui/plugin-portal" target="_blank" rel="noopener">GitHub</a>
      </nav>
    </section>
  </main>
</template>

<style scoped>
.signin {
  position: relative;
  min-height: 100vh;
  min-height: 100svh;
  background: var(--portal-faint);
}

.controls {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  right: 12px;
  z-index: 3;
  display: flex;
  gap: 4px;
  padding: 2px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--portal-card) 70%, transparent);
  backdrop-filter: blur(8px);
}

/* Narrow screens: the wall above, the sign in as a sheet that rises from the bottom. */
.narrow {
  display: flex;
  flex-direction: column;
}

.narrow .wall {
  flex: 1 1 auto;
  min-height: 34svh;
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}

.narrow .sheet {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 520px;
  margin: -32px auto 0;
  box-sizing: border-box;
  padding: 28px 24px calc(20px + env(safe-area-inset-bottom));
  border-radius: 28px 28px 0 0;
  background: var(--portal-card);
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.08);
  animation: sheet-in 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@keyframes sheet-in {
  from {
    transform: translateY(40px);
    opacity: 0;
  }

  to {
    transform: none;
    opacity: 1;
  }
}

/* Wide screens: the wall fills the left half, the sign in the right. */
.wide {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(460px, 0.9fr);
}

.wide .wall {
  min-height: 100vh;
  border-right: 1px solid var(--portal-border);
}

.wide .sheet {
  align-self: center;
  justify-self: center;
  width: 100%;
  max-width: 440px;
  padding: 64px 32px;
  box-sizing: border-box;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.headline {
  margin: 16px 0 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
}

.wide .headline {
  margin-top: 28px;
  font-size: 34px;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.feature-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  font-size: 20px;
  border-radius: 12px;
  color: var(--portal-primary-text);
  background: var(--portal-primary-bg);
}

.feature-title {
  font-weight: 600;
}

.feature-text {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.65;
}

.features {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
}

.narrow .features {
  gap: 14px;
  margin-top: 20px;
}

.features li {
  display: flex;
  gap: 14px;
}

.rotator {
  margin-top: 20px;
}

.rotator-item {
  display: flex;
  gap: 14px;
  min-height: 72px;
}

.dots {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  padding-inline-start: 54px;
}

.dot {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: var(--portal-border-strong);
  cursor: pointer;
  transition: width 0.3s ease, background 0.3s ease;
}

.dot.on {
  width: 18px;
  background: var(--portal-primary);
}

.feature-enter-active,
.feature-leave-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.feature-enter-from {
  opacity: 0;
  transform: translateX(16px);
}

.feature-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}

.alert {
  margin-top: 20px;
}

.github {
  height: 48px;
  margin-top: 24px;
  border-radius: 12px;
  font-size: 16px;
}

.wide .github {
  margin-top: 36px;
}

.trust {
  margin-top: 14px;
  text-align: center;
  font-size: 13px;
}

.safe {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--portal-ok-text);
}

.reads-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding: 6px 8px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  opacity: 0.6;
  cursor: pointer;
}

.reads {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 0;
  padding: 14px 16px;
  list-style: none;
  border-radius: 12px;
  background: var(--portal-faint);
  border: 1px solid var(--portal-border);
  text-align: start;
  line-height: 1.5;
}

.reads li {
  display: flex;
  gap: 8px;
}

.reads li > span:first-child {
  flex: none;
  margin-top: 2px;
  opacity: 0.6;
}

.reads-enter-active,
.reads-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.reads-enter-from,
.reads-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.links {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin-top: 20px;
  font-size: 13px;
}

.wide .links {
  margin-top: 32px;
}

/* Each part of the sign in fades in shortly after the one before it. */
.step {
  animation: step-in 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: calc(0.15s + var(--i, 0) * 0.07s);
}

@keyframes step-in {
  from {
    transform: translateY(12px);
    opacity: 0;
  }

  to {
    transform: none;
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .step,
  .narrow .sheet {
    animation: none;
  }

  .feature-enter-active,
  .feature-leave-active,
  .reads-enter-active,
  .reads-leave-active,
  .dot {
    transition: none;
  }
}
</style>
