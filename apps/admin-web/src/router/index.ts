import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { contentInspectionEnabled } from '../config/runtime'
import { defaultAdminRoute, routeIsPermitted } from '../state/platform-access'
import { restoreSession, sessionState } from '../state/session'
import type { PlatformCapability } from '../types/platform'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    requiresInspection?: boolean
    requiredCapability?: PlatformCapability
  }
}

const resourceRoutes = [
  ['users', '用户', 'PLATFORM_USERS_READ'],
  ['households', '家庭', 'PLATFORM_HOUSEHOLDS_READ'],
  ['devices', '设备', 'PLATFORM_DEVICES_READ'],
  ['model-sessions', '模型会话', 'PLATFORM_MODEL_SESSIONS_READ'],
  ['remote-sessions', '远程会话', 'PLATFORM_REMOTE_SESSIONS_READ'],
  ['audit-logs', '审计日志', 'PLATFORM_AUDIT_LOGS_READ']
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
      {
        path: '',
        name: 'admin-home',
        component: () => import('../views/AdminEntryView.vue'),
        meta: { requiresAuth: true }
      },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: {
          title: '运行概览',
          requiresAuth: true,
          requiredCapability: 'PLATFORM_DASHBOARD_READ'
        }
      },
      {
        path: 'prompts',
        name: 'prompts',
        component: () => import('../views/PromptManagementView.vue'),
        meta: {
          title: '提示词',
          requiresAuth: true,
          requiredCapability: 'PLATFORM_PROMPTS_READ'
        }
      },
      ...resourceRoutes.map(
        ([resourceKey, title, requiredCapability]): RouteRecordRaw => ({
          path: resourceKey,
          name: resourceKey,
          component: () => import('../views/ResourceListView.vue'),
          props: { resourceKey },
          meta: { title, requiresAuth: true, requiredCapability }
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
                requiresInspection: true,
                requiredCapability: 'INSPECTION_GRANTS_READ'
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

  if (to.name === 'admin-home' && sessionState.status === 'authenticated') {
    return defaultAdminRoute(sessionState.identity)
  }

  if (
    to.meta.requiredCapability &&
    !routeIsPermitted(sessionState.identity, to.meta.requiredCapability)
  ) {
    return defaultAdminRoute(sessionState.identity)
  }

  if (to.name === 'login' && sessionState.status === 'authenticated') {
    return defaultAdminRoute(sessionState.identity)
  }

  return true
})

router.afterEach((to) => {
  document.title = `${to.meta.title || '管理中心'} · 守忆灯塔`
})
