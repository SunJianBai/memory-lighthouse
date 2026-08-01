import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { contentInspectionEnabled } from '../config/runtime'
import { restoreSession, sessionState } from '../state/session'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    requiresInspection?: boolean
  }
}

const resourceRoutes = [
  ['users', '用户'],
  ['households', '家庭'],
  ['devices', '设备'],
  ['model-sessions', '模型会话'],
  ['remote-sessions', '远程会话'],
  ['audit-logs', '审计日志']
] as const

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    component: () => import('../layouts/AdminShell.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { title: '运行概览', requiresAuth: true }
      },
      ...resourceRoutes.map(
        ([resourceKey, title]): RouteRecordRaw => ({
          path: resourceKey,
          name: resourceKey,
          component: () => import('../views/ResourceListView.vue'),
          props: { resourceKey },
          meta: { title, requiresAuth: true }
        })
      ),
      ...(contentInspectionEnabled
        ? [
            {
              path: 'content-inspection',
              name: 'content-inspection',
              component: () => import('../views/ContentInspectionView.vue'),
              meta: {
                title: '开发期原文检查',
                requiresAuth: true,
                requiresInspection: true
              }
            } satisfies RouteRecordRaw
          ]
        : [])
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
    meta: { title: '页面不存在' }
  }
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach(async (to) => {
  if (sessionState.status === 'booting') {
    await restoreSession()
  }

  if (to.meta.requiresInspection && !contentInspectionEnabled) {
    return { name: 'dashboard', query: { inspection: 'disabled' } }
  }

  if (to.meta.requiresAuth && sessionState.status !== 'authenticated') {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.name === 'login' && sessionState.status === 'authenticated') {
    return { name: 'dashboard' }
  }

  return true
})

router.afterEach((to) => {
  document.title = `${to.meta.title || '管理中心'} · 守忆灯塔`
})
