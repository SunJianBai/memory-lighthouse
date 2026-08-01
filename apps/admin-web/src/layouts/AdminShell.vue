<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import AppIcon from '../components/AppIcon.vue'
import { contentInspectionEnabled, deploymentEnvironment } from '../config/runtime'
import { hasPlatformCapability } from '../state/platform-access'
import { logout, sessionState } from '../state/session'
import { currentTheme, toggleTheme } from '../state/theme'
import type { PlatformCapability } from '../types/platform'

interface NavigationItem {
  to: string
  label: string
  icon: string
  requiredCapability: PlatformCapability
  risk?: boolean
}

const route = useRoute()
const router = useRouter()
const mainElement = ref<HTMLElement | null>(null)
const mobileNavigationOpen = ref(false)
const loggingOut = ref(false)

const navigation = computed<NavigationItem[]>(() => {
  const items: NavigationItem[] = [
    {
      to: '/dashboard',
      label: '运行概览',
      icon: 'dashboard',
      requiredCapability: 'PLATFORM_DASHBOARD_READ'
    },
    { to: '/users', label: '用户', icon: 'users', requiredCapability: 'PLATFORM_USERS_READ' },
    {
      to: '/households',
      label: '家庭',
      icon: 'home',
      requiredCapability: 'PLATFORM_HOUSEHOLDS_READ'
    },
    {
      to: '/devices',
      label: '设备',
      icon: 'device',
      requiredCapability: 'PLATFORM_DEVICES_READ'
    },
    {
      to: '/model-sessions',
      label: '模型会话',
      icon: 'model',
      requiredCapability: 'PLATFORM_MODEL_SESSIONS_READ'
    },
    {
      to: '/remote-sessions',
      label: '远程会话',
      icon: 'call',
      requiredCapability: 'PLATFORM_REMOTE_SESSIONS_READ'
    },
    {
      to: '/audit-logs',
      label: '审计日志',
      icon: 'audit',
      requiredCapability: 'PLATFORM_AUDIT_LOGS_READ'
    }
  ]
  if (contentInspectionEnabled) {
    items.push({
      to: '/content-inspection',
      label: '开发期原文检查',
      icon: 'inspection',
      requiredCapability: 'INSPECTION_GRANTS_READ',
      risk: true
    })
  }
  return items.filter((item) =>
    hasPlatformCapability(sessionState.identity, item.requiredCapability)
  )
})

const routeTitle = computed(() => String(route.meta.title || '管理中心'))

watch(
  () => route.fullPath,
  async () => {
    mobileNavigationOpen.value = false
    await nextTick()
    mainElement.value?.focus({ preventScroll: true })
  }
)

watch(
  () => sessionState.status,
  (status) => {
    if (status === 'anonymous') {
      void router.replace({ name: 'login', query: { redirect: route.fullPath } })
    }
  }
)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') mobileNavigationOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

async function signOut(): Promise<void> {
  loggingOut.value = true
  try {
    await logout()
    await router.replace({ name: 'login' })
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <div class="admin-shell">
    <button
      v-if="mobileNavigationOpen"
      class="navigation-scrim"
      type="button"
      aria-label="关闭导航"
      @click="mobileNavigationOpen = false"
    ></button>

    <aside id="admin-sidebar" class="sidebar" :class="{ 'sidebar--open': mobileNavigationOpen }" aria-label="主管理导航">
      <div class="brand">
        <span class="brand__mark"><AppIcon name="lighthouse" :size="27" /></span>
        <span>
          <strong>守忆灯塔</strong>
          <small>管理中心</small>
        </span>
      </div>

      <nav class="sidebar__navigation">
        <p class="navigation-label">平台运营</p>
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="navigation-item"
          :class="{ 'navigation-item--risk': item.risk }"
        >
          <AppIcon :name="item.icon" :size="20" />
          <span>{{ item.label }}</span>
          <span v-if="item.risk" class="navigation-item__risk">受审计</span>
        </RouterLink>
      </nav>

      <div class="sidebar__footer">
        <span class="environment-badge" :class="`environment-badge--${deploymentEnvironment}`">
          {{ deploymentEnvironment === 'development' ? '开发环境' : '生产环境' }}
        </span>
        <p>API 数据实时读取，不使用演示数据。</p>
      </div>
    </aside>

    <div class="shell-content">
      <header class="topbar">
        <div class="topbar__title">
          <button
            class="icon-button mobile-menu-button"
            type="button"
            :aria-expanded="mobileNavigationOpen"
            aria-controls="admin-sidebar"
            aria-label="打开主导航"
            @click="mobileNavigationOpen = true"
          >
            <AppIcon name="menu" />
          </button>
          <div>
            <span>平台运营</span>
            <strong>{{ routeTitle }}</strong>
          </div>
        </div>

        <div class="topbar__actions">
          <div class="account-summary">
            <span class="account-summary__avatar" aria-hidden="true">{{ sessionState.user?.displayName.slice(0, 1) || '管' }}</span>
            <span class="account-summary__text">
              <strong>{{ sessionState.user?.displayName || '管理员' }}</strong>
              <small>安全会话</small>
            </span>
          </div>
          <button
            type="button"
            class="icon-button"
            :aria-label="currentTheme === 'light' ? '切换为深色主题' : '切换为浅色主题'"
            @click="toggleTheme"
          >
            <AppIcon :name="currentTheme === 'light' ? 'moon' : 'sun'" />
          </button>
          <button type="button" class="button button--quiet" :disabled="loggingOut" @click="signOut">
            <AppIcon name="logout" :size="18" />
            {{ loggingOut ? '退出中…' : '退出' }}
          </button>
        </div>
      </header>

      <main id="main-content" ref="mainElement" class="main-content" tabindex="-1">
        <RouterView />
      </main>
    </div>
  </div>
</template>
