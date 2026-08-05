<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '../components/AppIcon.vue'
import { defaultAdminRoute } from '../state/platform-access'
import { login, sessionState } from '../state/session'
import { formatError } from '../utils/format'

const route = useRoute()
const router = useRouter()
const identifier = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const errorMessage = ref('')

const canSubmit = computed(
  () => identifier.value.trim().length > 0 && password.value.length > 0 && !submitting.value
)

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  submitting.value = true
  errorMessage.value = ''

  try {
    await login(identifier.value.trim(), password.value)
    const fallback = defaultAdminRoute(sessionState.identity)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : fallback
    await router.replace(redirect.startsWith('/') ? redirect : fallback)
  } catch (error) {
    errorMessage.value = formatError(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-introduction" aria-labelledby="product-title">
      <div class="brand brand--login">
        <span class="brand__mark"><AppIcon name="lighthouse" :size="30" /></span>
        <span><strong>守忆灯塔</strong><small>Memory Lighthouse</small></span>
      </div>
      <div>
        <p class="eyebrow">平台运营</p>
        <h1 id="product-title">守忆灯塔管理中心</h1>
      </div>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <form class="login-card" @submit.prevent="submit">
        <div class="login-card__heading">
          <p class="eyebrow">受控入口</p>
          <h2 id="login-title">登录管理中心</h2>
          <p>请使用已授予平台角色的邮箱或用户名。</p>
        </div>

        <div v-if="errorMessage" class="inline-alert inline-alert--danger" role="alert">
          <AppIcon name="warning" :size="20" />
          <span>{{ errorMessage }}</span>
        </div>

        <label class="field">
          <span>邮箱或用户名</span>
          <input
            v-model="identifier"
            name="identifier"
            type="text"
            autocomplete="username"
            required
            placeholder="name@example.com"
          />
        </label>

        <label class="field">
          <span>密码</span>
          <input
            v-model="password"
            name="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            required
            placeholder="请输入密码"
          />
        </label>

        <label class="checkbox-field checkbox-field--compact">
          <input v-model="showPassword" type="checkbox" />
          <span>显示密码</span>
        </label>

        <button class="button button--primary button--full" type="submit" :disabled="!canSubmit">
          <span v-if="submitting" class="spinner spinner--small" aria-hidden="true"></span>
          <AppIcon v-else name="lock" :size="18" />
          {{ submitting ? '正在验证…' : '安全登录' }}
        </button>

        <p class="login-card__privacy">
          管理操作将记录在审计日志中。
        </p>
      </form>
    </section>
  </main>
</template>
