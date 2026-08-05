<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getDashboard } from '../api/platform'
import AppIcon from '../components/AppIcon.vue'
import StatePanel from '../components/StatePanel.vue'
import type { OperationsDashboard } from '../types/platform'
import { formatDate, formatError, formatNumber } from '../utils/format'

const route = useRoute()
const dashboard = ref<OperationsDashboard | null>(null)
const loading = ref(true)
const errorMessage = ref('')

const inspectionDisabledNotice = computed(() => route.query.inspection === 'disabled')

const cards = computed(() => {
  if (!dashboard.value) return []
  return [
    {
      label: '用户总数',
      value: dashboard.value.users.total,
      detail: `${formatNumber(dashboard.value.users.active)} 个活跃账号`,
      icon: 'users'
    },
    {
      label: '家庭空间',
      value: dashboard.value.households.total,
      detail: '已创建家庭',
      icon: 'home'
    },
    {
      label: '设备总数',
      value: dashboard.value.devices.total,
      detail: `${formatNumber(dashboard.value.devices.activelyBound)} 台有效绑定`,
      icon: 'device'
    },
    {
      label: '模型会话（24h）',
      value: dashboard.value.modelSessions.last24Hours,
      detail: `${formatNumber(dashboard.value.modelSessions.failedLast24Hours)} 次失败`,
      icon: 'model'
    },
    {
      label: '远程会话（24h）',
      value: dashboard.value.remoteSessions.last24Hours,
      detail: '现场接听模式',
      icon: 'call'
    },
    {
      label: '待审批检查授权',
      value: dashboard.value.inspectionGrants.pending,
      detail: '开发环境限定',
      icon: 'inspection'
    }
  ]
})

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    dashboard.value = await getDashboard()
  } catch (error) {
    dashboard.value = null
    errorMessage.value = formatError(error)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">Operations overview</p>
        <h1 id="page-title">运行概览</h1>
        <p>平台运行数据概览。</p>
      </div>
      <button class="button button--secondary" type="button" :disabled="loading" @click="load">
        <AppIcon name="refresh" :size="18" />
        刷新
      </button>
    </header>

    <div v-if="inspectionDisabledNotice" class="inline-alert inline-alert--info" role="status">
      <AppIcon name="lock" :size="20" />
      <span>原文检查：未启用</span>
    </div>

    <StatePanel
      v-if="loading"
      kind="loading"
      title="正在读取平台状态"
      message="正在连接 server-api，请稍候。"
    />
    <StatePanel
      v-else-if="errorMessage"
      kind="error"
      title="概览加载失败"
      :message="errorMessage"
      action-label="重新加载"
      @action="load"
    />

    <template v-else-if="dashboard">
      <section class="metric-grid" aria-label="平台关键指标">
        <article v-for="card in cards" :key="card.label" class="metric-card">
          <span class="metric-card__icon"><AppIcon :name="card.icon" :size="22" /></span>
          <div>
            <p>{{ card.label }}</p>
            <strong>{{ formatNumber(card.value) }}</strong>
            <small>{{ card.detail }}</small>
          </div>
        </article>
      </section>

      <details class="surface operational-note">
        <summary>数据范围</summary>
        <p>概览不包含长者记忆或对话原文。</p>
        <p>快照时间：{{ formatDate(dashboard.generatedAt) }}</p>
      </details>
    </template>
  </div>
</template>
