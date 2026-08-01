<script setup lang="ts">
import { RouterLink } from 'vue-router'

import AppIcon from '../components/AppIcon.vue'
</script>

<template>
  <main class="standalone-state">
    <AppIcon name="lighthouse" :size="48" />
    <p class="eyebrow">404</p>
    <h1>没有找到这个页面</h1>
    <p>地址可能已变更，或当前构建未开放该能力。</p>
    <RouterLink class="button button--primary" to="/dashboard">返回运行概览</RouterLink>
  </main>
</template>
