<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";

import {
  getCurrentCompanionPrompt,
  publishCompanionPrompt,
} from "../api/platform";
import AppIcon from "../components/AppIcon.vue";
import StatePanel from "../components/StatePanel.vue";
import { hasPlatformCapability } from "../state/platform-access";
import { sessionState } from "../state/session";
import type { CompanionPrompt } from "../types/platform";
import { formatDate, formatError } from "../utils/format";
import {
  buildPromptPublication,
  PROMPT_REASON_MAX_CHARACTERS,
  PROMPT_TEMPLATE_MAX_CHARACTERS,
  promptCanBePublished,
  promptCharacterCount,
  promptHasUnsavedChanges,
  promptReasonCharacterCount,
} from "./prompt-management-model";

const current = ref<CompanionPrompt | null>(null);
const draft = ref("");
const reason = ref("");
const loading = ref(false);
const publishing = ref(false);
const errorMessage = ref("");
const successMessage = ref("");
let requestSequence = 0;

const characterCount = computed(() => promptCharacterCount(draft.value));
const reasonCharacterCount = computed(() =>
  promptReasonCharacterCount(reason.value),
);
const changed = computed(() =>
  promptHasUnsavedChanges(current.value, draft.value),
);
const canPublish = computed(
  () =>
    hasPlatformCapability(sessionState.identity, "PLATFORM_PROMPTS_PUBLISH") &&
    !publishing.value &&
    promptCanBePublished(current.value, draft.value, reason.value),
);

async function load(force = false): Promise<void> {
  if (!force && !confirmDiscard()) {
    return;
  }
  const sequence = ++requestSequence;
  loading.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const result = await getCurrentCompanionPrompt();
    if (sequence !== requestSequence) return;
    current.value = result;
    draft.value = result.content;
    reason.value = "";
  } catch (error) {
    if (sequence === requestSequence) errorMessage.value = formatError(error);
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

async function publish(): Promise<void> {
  if (!current.value || !canPublish.value) return;
  if (!window.confirm("确认发布这个提示词修订？它会用于之后启动的陪伴会话。"))
    return;

  publishing.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const result = await publishCompanionPrompt(
      buildPromptPublication(current.value, draft.value, reason.value),
    );
    current.value = result;
    draft.value = result.content;
    reason.value = "";
    successMessage.value = "新修订已发布，将用于之后启动的陪伴会话。";
  } catch (error) {
    errorMessage.value = formatError(error);
  } finally {
    publishing.value = false;
  }
}

function confirmDiscard(): boolean {
  return (
    !changed.value ||
    window.confirm("当前有尚未发布的修改，离开后会丢失。确定继续吗？")
  );
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!changed.value) return;
  event.preventDefault();
  event.returnValue = "";
}

onBeforeRouteLeave(() => confirmDiscard());
onMounted(() => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  void load(true);
});
onBeforeUnmount(() =>
  window.removeEventListener("beforeunload", handleBeforeUnload),
);
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">MiniCPM-o 4.5 全双工全模态应用</p>
        <h1 id="page-title">提示词</h1>
        <p>查看当前基础提示词并发布不可变修订。</p>
      </div>
      <button
        class="button button--secondary"
        type="button"
        :disabled="loading || publishing"
        @click="load()"
      >
        <AppIcon name="refresh" :size="18" />
        {{ loading ? "刷新中…" : "刷新" }}
      </button>
    </header>

    <div class="inline-alert inline-alert--info" role="note">
      <AppIcon name="warning" :size="20" />
      <span
        >新修订只影响之后启动的模型会话；已开始的会话仍使用启动时固定的版本。</span
      >
    </div>

    <div
      v-if="errorMessage"
      class="inline-alert inline-alert--danger"
      role="alert"
    >
      <AppIcon name="warning" :size="20" />
      <span>{{ errorMessage }}</span>
    </div>
    <div
      v-if="successMessage"
      class="inline-alert inline-alert--success"
      role="status"
    >
      <AppIcon name="check" :size="20" />
      <span>{{ successMessage }}</span>
    </div>

    <StatePanel
      v-if="loading && !current"
      kind="loading"
      title="正在读取提示词"
      message="请稍候。"
    />

    <template v-else-if="current">
      <section class="surface prompt-summary" aria-label="当前提示词信息">
        <dl class="snapshot-metadata">
          <div>
            <dt>模型</dt>
            <dd>{{ current.model }}</dd>
          </div>
          <div>
            <dt>服务商</dt>
            <dd>{{ current.provider }}</dd>
          </div>
          <div>
            <dt>组合器版本</dt>
            <dd>v{{ current.composerVersion }}</dd>
          </div>
          <div>
            <dt>发布时间</dt>
            <dd>{{ formatDate(current.publishedAt) }}</dd>
          </div>
          <div>
            <dt>修订 ID</dt>
            <dd class="mono-value">{{ current.id }}</dd>
          </div>
          <div>
            <dt>内容哈希</dt>
            <dd class="mono-value">{{ current.contentHash }}</dd>
          </div>
        </dl>
      </section>

      <form class="surface prompt-editor" @submit.prevent="publish">
        <label class="field">
          <span>基础系统提示词</span>
          <textarea
            v-model="draft"
            rows="18"
            spellcheck="false"
            :aria-invalid="characterCount > PROMPT_TEMPLATE_MAX_CHARACTERS"
          ></textarea>
          <small
            :class="{
              'character-count--invalid':
                characterCount > PROMPT_TEMPLATE_MAX_CHARACTERS,
            }"
          >
            {{ characterCount }} / {{ PROMPT_TEMPLATE_MAX_CHARACTERS }} 字符
          </small>
        </label>

        <label class="field">
          <span>发布说明 <b aria-hidden="true">*</b></span>
          <input
            v-model="reason"
            type="text"
            placeholder="例如：减少重复回复并缩短默认回答"
            autocomplete="off"
            aria-describedby="publication-reason-help"
            :aria-invalid="reasonCharacterCount > PROMPT_REASON_MAX_CHARACTERS"
          />
          <small id="publication-reason-help" class="field-help-row">
            <span>说明会写入审计记录。</span>
            <span
              :class="{
                'character-count--invalid':
                  reasonCharacterCount > PROMPT_REASON_MAX_CHARACTERS,
              }"
            >
              {{ reasonCharacterCount }} /
              {{ PROMPT_REASON_MAX_CHARACTERS }} 字符
            </span>
          </small>
        </label>

        <div class="prompt-editor__actions">
          <span v-if="!changed" class="prompt-editor__hint"
            >正文修改后才能发布新修订。</span
          >
          <button
            class="button button--primary"
            type="submit"
            :disabled="!canPublish"
          >
            <AppIcon name="check" :size="18" />
            {{ publishing ? "发布中…" : "发布新修订" }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.prompt-summary,
.prompt-editor {
  padding: var(--space-5);
}

.prompt-summary {
  max-width: 920px;
}

.prompt-editor {
  display: grid;
  max-width: 1100px;
  gap: var(--space-5);
}

.prompt-editor textarea {
  min-height: 360px;
  font-family: "Fira Code", ui-monospace, SFMono-Regular, Consolas, monospace;
  line-height: 1.65;
}

.prompt-editor__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.prompt-editor__hint {
  color: var(--color-text-subtle);
  font-size: 0.85rem;
}

.mono-value {
  font-family: "Fira Code", ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.82rem;
}

.character-count--invalid {
  color: var(--color-danger) !important;
  font-weight: 700 !important;
}

.field-help-row {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2);
}

@media (max-width: 680px) {
  .prompt-editor textarea {
    min-height: 300px;
  }

  .prompt-editor__actions .button {
    width: 100%;
  }
}
</style>
