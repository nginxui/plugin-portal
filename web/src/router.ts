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
