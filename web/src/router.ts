import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '@/stores/session'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    maintainer?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/plugins' },
    { path: '/signin', name: 'signin', component: () => import('@/views/SignIn.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('@/layouts/PortalLayout.vue'),
      children: [
        { path: 'plugins', name: 'plugins', component: () => import('@/views/MyPlugins.vue') },
        {
          path: 'plugins/:id',
          component: () => import('@/views/plugin/PluginLayout.vue'),
          children: [
            { path: '', name: 'plugin', component: () => import('@/views/plugin/PluginStore.vue') },
            { path: 'screenshots', name: 'plugin-screenshots', component: () => import('@/views/plugin/PluginScreenshots.vue') },
            { path: 'versions', name: 'plugin-versions', component: () => import('@/views/plugin/PluginVersions.vue') },
            { path: 'signers', name: 'plugin-signers', component: () => import('@/views/plugin/PluginVersions.vue'), props: { section: 'signers' } },
            { path: 'access', name: 'plugin-access', component: () => import('@/views/plugin/PluginAccess.vue') },
          ],
        },
        { path: 'submit', name: 'submit', component: () => import('@/views/SubmitPlugin.vue') },
        { path: 'changes/:id', name: 'change', component: () => import('@/views/ChangeView.vue') },
        { path: 'review', name: 'review', component: () => import('@/views/review/ReviewQueue.vue'), meta: { maintainer: true } },
        { path: 'review/:id', name: 'review-change', component: () => import('@/views/review/ReviewChange.vue'), meta: { maintainer: true } },
        { path: 'audit', name: 'audit', component: () => import('@/views/maintain/AuditLog.vue'), meta: { maintainer: true } },
        { path: 'owners', name: 'owners', component: () => import('@/views/owners/OwnerList.vue') },
        { path: 'owners/:login', name: 'owner', component: () => import('@/views/owners/OwnerPage.vue') },
      ],
    },
    { path: '/:path(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue'), meta: { public: true } },
  ],
})

router.beforeEach(async (to) => {
  const session = useSessionStore()
  await session.load().catch(() => {})
  if (to.name === 'signin' && session.isSignedIn)
    return typeof to.query.next === 'string' && to.query.next.startsWith('/') && !to.query.next.startsWith('//') ? to.query.next : '/plugins'
  if (!to.meta.public && !session.isSignedIn)
    return { name: 'signin', query: { next: to.fullPath } }
  if (to.meta.maintainer && !session.isMaintainer)
    return '/plugins'
})

// A deploy replaces the page chunks, so a tab opened before it cannot load
// the next page. Load that page in full instead, once, to pick up the new build.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk/i
router.onError((error, to) => {
  if (!CHUNK_ERROR.test(String((error as Error)?.message ?? error)))
    return
  try {
    if (sessionStorage.getItem('portal-chunk-reload') === to.fullPath)
      return
    sessionStorage.setItem('portal-chunk-reload', to.fullPath)
  }
  catch {}
  window.location.assign(to.fullPath)
})

router.afterEach(() => {
  try {
    sessionStorage.removeItem('portal-chunk-reload')
  }
  catch {}
})
