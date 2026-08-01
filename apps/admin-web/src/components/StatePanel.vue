<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    kind: 'loading' | 'empty' | 'error' | 'locked'
    title: string
    message: string
    actionLabel?: string
  }>(),
  { actionLabel: '' }
)

defineEmits<{ action: [] }>()
</script>

<template>
  <section class="state-panel" :class="`state-panel--${kind}`" :aria-busy="kind === 'loading'">
    <span v-if="kind === 'loading'" class="spinner" aria-hidden="true"></span>
    <AppIcon v-else :name="kind === 'error' ? 'warning' : kind === 'locked' ? 'lock' : 'database'" :size="28" />
    <div>
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
    </div>
    <button v-if="actionLabel" type="button" class="button button--secondary" @click="$emit('action')">
      <AppIcon name="refresh" :size="18" />
      {{ actionLabel }}
    </button>
  </section>
</template>
