<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { ApiRequestError } from '../api/client'
import {
  approveInspectionGrant,
  inspectMemory,
  inspectUtterance,
  listInspectionGrants,
  requestInspectionGrant,
  revokeInspectionGrant
} from '../api/platform'
import AppIcon from '../components/AppIcon.vue'
import StatePanel from '../components/StatePanel.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { sessionState } from '../state/session'
import type {
  InspectionDataCategory,
  InspectionGrant,
  MemoryInspectionResult,
  PlatformPage,
  UtteranceInspectionResult
} from '../types/platform'
import { formatDate, formatError } from '../utils/format'

type InspectionKind = 'memory' | 'utterance'
type InspectionResult =
  | { kind: 'memory'; value: MemoryInspectionResult }
  | { kind: 'utterance'; value: UtteranceInspectionResult }

const REQUIRED_CONFIRMATION = '我理解查看将被审计'
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i

const grants = ref<PlatformPage<InspectionGrant> | null>(null)
const grantsLoading = ref(true)
const grantsError = ref('')
const runtimeAvailable = ref(true)
const mutationId = ref('')
const successMessage = ref('')

const filters = reactive({ householdId: '', status: '' })
const requestForm = reactive({
  householdId: '',
  recipientId: '',
  memoryRevision: true,
  conversationUtterance: false,
  reason: '',
  ticketReference: '',
  expiresInSeconds: 300
})
const requestError = ref('')
const requesting = ref(false)

const lookup = reactive({
  kind: 'memory' as InspectionKind,
  resourceId: '',
  revisionId: '',
  grantId: '',
  acknowledgement: false,
  confirmation: ''
})
const inspectionLoading = ref(false)
const inspectionError = ref('')
const inspectionResult = ref<InspectionResult | null>(null)
let clearResultTimer: number | undefined

const requiredCategory = computed<InspectionDataCategory>(() =>
  lookup.kind === 'memory' ? 'MEMORY_REVISION' : 'CONVERSATION_UTTERANCE'
)

const usableGrants = computed(() => {
  const now = Date.now()
  const userId = sessionState.user?.id
  return (grants.value?.items || []).filter(
    (grant) =>
      grant.status === 'ACTIVE' &&
      grant.requestedByUserId === userId &&
      new Date(grant.expiresAt).getTime() > now &&
      grant.dataCategories.includes(requiredCategory.value)
  )
})

const canInspect = computed(
  () =>
    lookup.resourceId.trim().length === 26 &&
    lookup.grantId.length === 26 &&
    lookup.acknowledgement &&
    lookup.confirmation.trim() === REQUIRED_CONFIRMATION &&
    !inspectionLoading.value
)

watch(
  () => lookup.kind,
  () => {
    lookup.grantId = ''
    lookup.revisionId = ''
    clearInspectionResult()
  }
)

function markUnavailable(error: unknown): boolean {
  if (
    error instanceof ApiRequestError &&
    error.code === 'DEVELOPMENT_CONTENT_INSPECTION_UNAVAILABLE'
  ) {
    runtimeAvailable.value = false
    return true
  }
  return false
}

async function loadGrants(targetPage = 1): Promise<void> {
  grantsLoading.value = true
  grantsError.value = ''
  try {
    grants.value = await listInspectionGrants({
      page: targetPage,
      limit: 20,
      householdId: filters.householdId.trim() || undefined,
      status: filters.status || undefined
    })
    runtimeAvailable.value = true
  } catch (error) {
    grants.value = null
    if (!markUnavailable(error)) grantsError.value = formatError(error)
  } finally {
    grantsLoading.value = false
  }
}

function selectedCategories(): InspectionDataCategory[] {
  const categories: InspectionDataCategory[] = []
  if (requestForm.memoryRevision) categories.push('MEMORY_REVISION')
  if (requestForm.conversationUtterance) categories.push('CONVERSATION_UTTERANCE')
  return categories
}

async function submitGrantRequest(): Promise<void> {
  requestError.value = ''
  successMessage.value = ''
  const categories = selectedCategories()
  if (!ULID_PATTERN.test(requestForm.householdId.trim())) {
    requestError.value = '请输入有效的 26 位家庭 ID。'
    return
  }
  if (requestForm.recipientId.trim() && !ULID_PATTERN.test(requestForm.recipientId.trim())) {
    requestError.value = '长者 ID 应为 26 位；如需家庭级授权可以留空。'
    return
  }
  if (categories.length === 0) {
    requestError.value = '至少选择一种数据类别。'
    return
  }
  if (!requestForm.reason.trim()) {
    requestError.value = '请说明本次检查的具体原因。'
    return
  }

  requesting.value = true
  try {
    await requestInspectionGrant({
      householdId: requestForm.householdId.trim(),
      ...(requestForm.recipientId.trim() ? { recipientId: requestForm.recipientId.trim() } : {}),
      dataCategories: categories,
      reason: requestForm.reason.trim(),
      ...(requestForm.ticketReference.trim()
        ? { ticketReference: requestForm.ticketReference.trim() }
        : {}),
      expiresInSeconds: Number(requestForm.expiresInSeconds)
    })
    successMessage.value = '检查授权申请已提交，必须由另一名管理员审批后才能使用。'
    requestForm.reason = ''
    requestForm.ticketReference = ''
    await loadGrants(1)
  } catch (error) {
    if (!markUnavailable(error)) requestError.value = formatError(error)
  } finally {
    requesting.value = false
  }
}

async function mutateGrant(grant: InspectionGrant, action: 'approve' | 'revoke'): Promise<void> {
  mutationId.value = grant.id
  successMessage.value = ''
  grantsError.value = ''
  try {
    if (action === 'approve') {
      await approveInspectionGrant(grant.id)
      successMessage.value = '授权已审批；申请人现在可以在有效期内按范围检查原文。'
    } else {
      await revokeInspectionGrant(grant.id)
      successMessage.value = '授权已撤销，后续原文请求会被服务端拒绝。'
      if (lookup.grantId === grant.id) clearInspectionResult()
    }
    await loadGrants(grants.value?.page || 1)
  } catch (error) {
    if (!markUnavailable(error)) grantsError.value = formatError(error)
  } finally {
    mutationId.value = ''
  }
}

function clearInspectionResult(): void {
  inspectionResult.value = null
  inspectionError.value = ''
  if (clearResultTimer !== undefined) {
    window.clearTimeout(clearResultTimer)
    clearResultTimer = undefined
  }
}

async function inspectOriginal(): Promise<void> {
  if (!canInspect.value) return
  clearInspectionResult()
  inspectionLoading.value = true
  try {
    if (lookup.kind === 'memory') {
      inspectionResult.value = {
        kind: 'memory',
        value: await inspectMemory(
          lookup.resourceId.trim(),
          lookup.grantId,
          lookup.revisionId.trim() || undefined
        )
      }
    } else {
      inspectionResult.value = {
        kind: 'utterance',
        value: await inspectUtterance(lookup.resourceId.trim(), lookup.grantId)
      }
    }
    lookup.confirmation = ''
    lookup.acknowledgement = false
    clearResultTimer = window.setTimeout(clearInspectionResult, 60_000)
  } catch (error) {
    if (!markUnavailable(error)) inspectionError.value = formatError(error)
  } finally {
    inspectionLoading.value = false
  }
}

onMounted(() => loadGrants())
onBeforeUnmount(clearInspectionResult)
</script>

<template>
  <div class="page-stack inspection-page">
    <header class="page-header">
      <div>
        <p class="eyebrow eyebrow--danger">Development only · high risk</p>
        <h1 id="page-title">开发期原文检查</h1>
        <p>仅用于模型能力验证与已登记问题排查；原文查看不是普通管理功能。</p>
      </div>
      <RouterLink class="button button--secondary" to="/audit-logs">
        <AppIcon name="audit" :size="18" />查看审计日志
      </RouterLink>
    </header>

    <section class="risk-banner" role="alert">
      <AppIcon name="warning" :size="26" />
      <div>
        <strong>每次查看都会留下操作者、授权、资源与请求号水印，并写入哈希链审计日志。</strong>
        <p>必须存在家庭/长者当前同意，且申请人不能自批。页面不会持久化原文，并在 60 秒后自动清屏。</p>
      </div>
    </section>

    <StatePanel
      v-if="!runtimeAvailable"
      kind="locked"
      title="原文检查已由服务端关闭"
      message="这是非开发环境的预期安全状态。前端入口与服务端接口必须同时显式启用，否则不能查看原文。"
    />

    <template v-else>
      <p class="sr-only" aria-live="polite">{{ successMessage }}</p>
      <div v-if="successMessage" class="inline-alert inline-alert--success" role="status">
        <AppIcon name="check" :size="20" />{{ successMessage }}
      </div>

      <section class="surface inspection-section" aria-labelledby="grant-request-title">
        <div class="section-heading">
          <span class="step-number">1</span>
          <div><h2 id="grant-request-title">申请短期授权</h2><p>范围越小越好，最长 15 分钟。</p></div>
        </div>

        <form class="form-grid" @submit.prevent="submitGrantRequest">
          <label class="field">
            <span>家庭 ID <b aria-hidden="true">*</b></span>
            <input v-model="requestForm.householdId" required minlength="26" maxlength="26" autocomplete="off" placeholder="26 位 ULID" />
          </label>
          <label class="field">
            <span>长者 ID（建议填写）</span>
            <input v-model="requestForm.recipientId" maxlength="26" autocomplete="off" placeholder="留空表示家庭范围" />
            <small>指定长者可减少无关数据暴露。</small>
          </label>
          <fieldset class="field fieldset-span">
            <legend>数据类别 <b aria-hidden="true">*</b></legend>
            <div class="checkbox-row">
              <label class="checkbox-field"><input v-model="requestForm.memoryRevision" type="checkbox" />记忆修订原文</label>
              <label class="checkbox-field"><input v-model="requestForm.conversationUtterance" type="checkbox" />对话话轮原文</label>
            </div>
          </fieldset>
          <label class="field fieldset-span">
            <span>具体原因 <b aria-hidden="true">*</b></span>
            <textarea v-model="requestForm.reason" required maxlength="1000" rows="3" placeholder="说明待验证的模型行为或问题，不要填写无关隐私。"></textarea>
          </label>
          <label class="field">
            <span>工单/实验编号</span>
            <input v-model="requestForm.ticketReference" maxlength="100" autocomplete="off" placeholder="例如 EXP-2026-001" />
          </label>
          <label class="field">
            <span>有效期</span>
            <select v-model.number="requestForm.expiresInSeconds">
              <option :value="300">5 分钟</option>
              <option :value="600">10 分钟</option>
              <option :value="900">15 分钟</option>
            </select>
          </label>
          <div v-if="requestError" class="inline-alert inline-alert--danger fieldset-span" role="alert">
            <AppIcon name="warning" :size="20" />{{ requestError }}
          </div>
          <div class="form-actions fieldset-span">
            <button class="button button--primary" type="submit" :disabled="requesting">
              <span v-if="requesting" class="spinner spinner--small"></span>
              {{ requesting ? '提交中…' : '提交审批申请' }}
            </button>
          </div>
        </form>
      </section>

      <section class="surface inspection-section" aria-labelledby="grant-list-title">
        <div class="section-heading section-heading--between">
          <div class="section-heading__title">
            <span class="step-number">2</span>
            <div><h2 id="grant-list-title">审批与选择授权</h2><p>申请人与审批人必须是不同账号。</p></div>
          </div>
          <button class="button button--secondary" type="button" :disabled="grantsLoading" @click="loadGrants(grants?.page || 1)">
            <AppIcon name="refresh" :size="18" />刷新
          </button>
        </div>

        <form class="compact-filter" @submit.prevent="loadGrants(1)">
          <label class="field field--inline"><span>家庭 ID</span><input v-model="filters.householdId" maxlength="26" placeholder="可选" /></label>
          <label class="field field--inline"><span>状态</span><select v-model="filters.status"><option value="">全部</option><option value="PENDING">PENDING</option><option value="ACTIVE">ACTIVE</option><option value="REVOKED">REVOKED</option></select></label>
          <button class="button button--quiet" type="submit">筛选</button>
        </form>

        <StatePanel v-if="grantsLoading && !grants" kind="loading" title="正在读取授权" message="请稍候。" />
        <StatePanel v-else-if="grantsError" kind="error" title="授权读取失败" :message="grantsError" action-label="重试" @action="loadGrants(1)" />
        <StatePanel v-else-if="grants?.items.length === 0" kind="empty" title="暂无授权记录" message="提交申请后，授权会出现在这里。" />

        <div v-else-if="grants" class="table-scroll" tabindex="0" aria-label="检查授权表">
          <table class="data-table data-table--compact">
            <caption class="sr-only">开发期内容检查授权</caption>
            <thead><tr><th scope="col">授权/范围</th><th scope="col">申请与审批</th><th scope="col">数据类别</th><th scope="col">状态/有效期</th><th scope="col">操作</th></tr></thead>
            <tbody>
              <tr v-for="grant in grants.items" :key="grant.id">
                <td><span class="cell-mono">{{ grant.id }}</span><span class="cell-secondary">家庭 {{ grant.householdId }}<br />长者 {{ grant.recipientId || '家庭范围' }}</span></td>
                <td><span class="cell-mono">申请 {{ grant.requestedByUserId }}</span><span class="cell-secondary">审批 {{ grant.approvedByUserId || '待审批' }}<br />{{ grant.reason }}</span></td>
                <td>{{ grant.dataCategories.join('、') }}</td>
                <td><StatusBadge :status="grant.status" /><span class="cell-secondary">至 {{ formatDate(grant.expiresAt) }}</span></td>
                <td>
                  <div class="row-actions">
                    <button
                      v-if="grant.status === 'PENDING'"
                      class="button button--small button--secondary"
                      type="button"
                      :disabled="mutationId === grant.id || grant.requestedByUserId === sessionState.user?.id"
                      :title="grant.requestedByUserId === sessionState.user?.id ? '申请人不能审批自己的申请' : '审批授权'"
                      @click="mutateGrant(grant, 'approve')"
                    >审批</button>
                    <button
                      v-if="grant.status === 'PENDING' || grant.status === 'ACTIVE'"
                      class="button button--small button--danger-quiet"
                      type="button"
                      :disabled="mutationId === grant.id"
                      @click="mutateGrant(grant, 'revoke')"
                    >撤销</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="surface inspection-section inspection-section--danger" aria-labelledby="original-title">
        <div class="section-heading">
          <span class="step-number step-number--danger">3</span>
          <div><h2 id="original-title">按资源查看原文</h2><p>读取动作本身会立即产生审计记录。</p></div>
        </div>

        <form class="form-grid" @submit.prevent="inspectOriginal">
          <label class="field">
            <span>资源类型</span>
            <select v-model="lookup.kind"><option value="memory">记忆修订</option><option value="utterance">对话话轮</option></select>
          </label>
          <label class="field">
            <span>{{ lookup.kind === 'memory' ? '记忆 ID' : '话轮 ID' }}</span>
            <input v-model="lookup.resourceId" required minlength="26" maxlength="26" autocomplete="off" placeholder="26 位 ULID" />
          </label>
          <label v-if="lookup.kind === 'memory'" class="field">
            <span>修订 ID（可选）</span>
            <input v-model="lookup.revisionId" maxlength="26" autocomplete="off" placeholder="留空读取当前修订" />
          </label>
          <label class="field">
            <span>本人已申请并获批的有效授权</span>
            <select v-model="lookup.grantId" required>
              <option value="">请选择</option>
              <option v-for="grant in usableGrants" :key="grant.id" :value="grant.id">{{ grant.id }} · 至 {{ formatDate(grant.expiresAt) }}</option>
            </select>
            <small v-if="usableGrants.length === 0">当前列表中没有覆盖该数据类别的本人有效授权。</small>
          </label>
          <label class="checkbox-field fieldset-span acknowledgement">
            <input v-model="lookup.acknowledgement" type="checkbox" />
            <span>我确认本次查看与申请原因一致，且不会复制、传播或用于申请范围之外的目的。</span>
          </label>
          <label class="field fieldset-span">
            <span>输入确认语句：<b>{{ REQUIRED_CONFIRMATION }}</b></span>
            <input v-model="lookup.confirmation" autocomplete="off" :placeholder="REQUIRED_CONFIRMATION" />
          </label>
          <div v-if="inspectionError" class="inline-alert inline-alert--danger fieldset-span" role="alert"><AppIcon name="warning" :size="20" />{{ inspectionError }}</div>
          <div class="form-actions fieldset-span">
            <button class="button button--danger" type="submit" :disabled="!canInspect">
              <span v-if="inspectionLoading" class="spinner spinner--small"></span>
              <AppIcon v-else name="eye" :size="18" />
              {{ inspectionLoading ? '正在执行受审计读取…' : '查看原文并写入审计' }}
            </button>
            <button v-if="inspectionResult" class="button button--quiet" type="button" @click="clearInspectionResult">立即清屏</button>
          </div>
        </form>

        <article v-if="inspectionResult" class="original-result" aria-live="polite">
          <div class="original-result__watermark" aria-hidden="true">
            {{ inspectionResult.value.watermark.operatorUserId }} · {{ inspectionResult.value.watermark.grantId }} · {{ inspectionResult.value.watermark.requestId }}
          </div>
          <header>
            <div><p class="eyebrow eyebrow--danger">Original content · audited</p><h3>{{ inspectionResult.kind === 'memory' ? inspectionResult.value.title : `话轮 #${inspectionResult.value.sequenceNo}` }}</h3></div>
            <StatusBadge :status="inspectionResult.kind === 'memory' ? inspectionResult.value.verificationStatus : inspectionResult.value.speaker" />
          </header>
          <pre>{{ inspectionResult.kind === 'memory' ? inspectionResult.value.content : inspectionResult.value.rawText }}</pre>
          <dl class="original-result__metadata">
            <div><dt>操作者</dt><dd>{{ inspectionResult.value.watermark.operatorUserId }}</dd></div>
            <div><dt>授权</dt><dd>{{ inspectionResult.value.watermark.grantId }}</dd></div>
            <div><dt>请求号</dt><dd>{{ inspectionResult.value.watermark.requestId }}</dd></div>
            <div><dt>读取时间</dt><dd>{{ formatDate(inspectionResult.value.watermark.occurredAt) }}</dd></div>
          </dl>
        </article>
      </section>
    </template>
  </div>
</template>
