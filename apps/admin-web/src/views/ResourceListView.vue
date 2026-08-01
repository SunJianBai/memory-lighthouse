<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { listPlatformResource } from '../api/platform'
import AppIcon from '../components/AppIcon.vue'
import StatePanel from '../components/StatePanel.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { resourceDefinitions, type CellValue } from '../config/resources'
import type { PlatformPage } from '../types/platform'
import { formatError, formatNumber } from '../utils/format'

const props = defineProps<{ resourceKey: string }>()

const definition = computed(() => {
  const value = resourceDefinitions[props.resourceKey]
  if (!value) throw new Error(`Unknown platform resource: ${props.resourceKey}`)
  return value
})

const page = ref<PlatformPage | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const filters = reactive({ search: '', status: '' })
let requestSequence = 0

function cell(columnKey: string, row: Record<string, unknown>): CellValue {
  const column = definition.value.columns.find((item) => item.key === columnKey)
  return column ? column.cell(row) : { primary: '—' }
}

async function load(targetPage = 1): Promise<void> {
  const sequence = ++requestSequence
  loading.value = true
  errorMessage.value = ''

  try {
    const result = await listPlatformResource(definition.value.endpoint, {
      page: targetPage,
      limit: 20,
      search: filters.search.trim() || undefined,
      status: filters.status || undefined
    })
    if (sequence === requestSequence) page.value = result
  } catch (error) {
    if (sequence === requestSequence) {
      page.value = null
      errorMessage.value = formatError(error)
    }
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

function resetFilters(): void {
  filters.search = ''
  filters.status = ''
  void load(1)
}

watch(
  () => props.resourceKey,
  () => {
    filters.search = ''
    filters.status = ''
    page.value = null
    void load(1)
  },
  { immediate: true }
)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">Platform metadata</p>
        <h1 id="page-title">{{ definition.title }}</h1>
        <p>{{ definition.description }}</p>
      </div>
      <button class="button button--secondary" type="button" :disabled="loading" @click="load(page?.page || 1)">
        <AppIcon name="refresh" :size="18" />
        刷新
      </button>
    </header>

    <form class="surface filter-bar" role="search" @submit.prevent="load(1)">
      <label class="field field--inline">
        <span>关键词</span>
        <div class="input-with-icon">
          <AppIcon name="search" :size="18" />
          <input v-model="filters.search" type="search" :placeholder="definition.searchPlaceholder" />
        </div>
      </label>
      <label class="field field--inline">
        <span>状态</span>
        <select v-model="filters.status">
          <option value="">全部状态</option>
          <option v-for="status in definition.statusOptions" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <div class="filter-bar__actions">
        <button class="button button--primary" type="submit" :disabled="loading">查询</button>
        <button class="button button--quiet" type="button" :disabled="loading" @click="resetFilters">重置</button>
      </div>
    </form>

    <StatePanel
      v-if="loading && !page"
      kind="loading"
      title="正在读取数据"
      message="查询结果将直接来自 server-api。"
    />
    <StatePanel
      v-else-if="errorMessage"
      kind="error"
      title="数据加载失败"
      :message="errorMessage"
      action-label="重试"
      @action="load(1)"
    />
    <StatePanel
      v-else-if="page && page.items.length === 0"
      kind="empty"
      title="没有匹配记录"
      message="当前筛选条件下没有数据；可以调整关键词或状态后重试。"
      action-label="清除筛选"
      @action="resetFilters"
    />

    <section v-else-if="page" class="surface data-section" :aria-busy="loading">
      <div class="data-section__summary" aria-live="polite">
        <span>共 {{ formatNumber(page.total) }} 条记录</span>
        <span v-if="loading" class="loading-inline"><span class="spinner spinner--small"></span>更新中</span>
      </div>
      <div class="table-scroll" tabindex="0" aria-label="可横向滚动的数据表">
        <table class="data-table">
          <caption class="sr-only">{{ definition.title }}列表，共 {{ page.total }} 条</caption>
          <thead>
            <tr>
              <th
                v-for="column in definition.columns"
                :key="column.key"
                scope="col"
                :style="{ minWidth: `${column.minWidth}px` }"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in page.items" :key="String(row.id)">
              <td v-for="column in definition.columns" :key="column.key">
                <template v-if="cell(column.key, row).status">
                  <StatusBadge :status="cell(column.key, row).status" />
                  <span
                    v-if="cell(column.key, row).primary !== cell(column.key, row).status"
                    :class="{ 'cell-mono': cell(column.key, row).mono }"
                    class="cell-secondary cell-secondary--primary"
                  >
                    {{ cell(column.key, row).primary }}
                  </span>
                  <span v-if="cell(column.key, row).secondary" class="cell-secondary">
                    {{ cell(column.key, row).secondary }}
                  </span>
                </template>
                <template v-else>
                  <span :class="{ 'cell-mono': cell(column.key, row).mono }" :title="cell(column.key, row).secondary">
                    {{ cell(column.key, row).primary }}
                  </span>
                  <span v-if="cell(column.key, row).secondary" class="cell-secondary">
                    {{ cell(column.key, row).secondary }}
                  </span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" aria-label="分页">
        <span>第 {{ page.page }} 页</span>
        <div>
          <button
            class="icon-button"
            type="button"
            aria-label="上一页"
            :disabled="page.page <= 1 || loading"
            @click="load(page.page - 1)"
          ><AppIcon name="left" /></button>
          <button
            class="icon-button"
            type="button"
            aria-label="下一页"
            :disabled="!page.hasNext || loading"
            @click="load(page.page + 1)"
          ><AppIcon name="right" /></button>
        </div>
      </div>
    </section>
  </div>
</template>
