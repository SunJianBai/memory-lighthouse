<script setup lang="ts">
import { RouterView } from 'vue-router'

import { sessionState } from './state/session'
</script>

<template>
  <div v-if="sessionState.status === 'booting'" class="app-boot" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span>
    <span>正在恢复安全会话…</span>
  </div>
  <RouterView v-else />
</template>
