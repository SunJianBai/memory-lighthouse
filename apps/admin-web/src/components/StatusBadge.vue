<script setup lang="ts">
import { computed } from 'vue'

import { statusTone } from '../utils/format'

const props = defineProps<{ status: unknown }>()
const tone = computed(() => statusTone(props.status))
</script>

<template>
  <span class="status-badge" :class="`status-badge--${tone}`">
    <span class="status-badge__dot" aria-hidden="true"></span>
    {{ typeof status === 'string' && status ? status : '未知' }}
  </span>
</template>
