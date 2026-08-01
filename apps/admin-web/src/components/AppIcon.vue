<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    name: string
    size?: number
    label?: string
  }>(),
  { size: 20, label: '' }
)

const icons: Record<string, string[]> = {
  lighthouse: [
    'M9 12 10.5 5h3L15 12',
    'M10 9h4',
    'M8 22h8l-1-10H9L8 22Z',
    'M12 2v3',
    'M4 8l4 1',
    'M20 8l-4 1'
  ],
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v4h-7z', 'M14 11h7v10h-7z', 'M3 14h7v7H3z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  home: ['M3 11 12 3l9 8', 'M5 10v11h14V10', 'M9 21v-7h6v7'],
  device: ['M5 2h14v14H5z', 'M8 22h8', 'M12 16v6'],
  model: ['M12 8V4H8', 'M4 12H2', 'M22 12h-2', 'M12 20v-4', 'M6.3 17.7 4.9 19.1', 'M19.1 4.9 17.7 6.3', 'M6.3 6.3 4.9 4.9', 'M17.7 17.7 19.1 19.1', 'M7 8h10v8H7z'],
  call: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.8a2 2 0 0 1-.45 2.11L8.07 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.32 1.84.55 2.8.68A2 2 0 0 1 22 16.92Z'],
  audit: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M9 13h6', 'M9 17h6'],
  inspection: ['M10 2h4', 'M9 2h6l1 4H8l1-4Z', 'M8 6 5 21h14L16 6', 'M9 14h6'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4'],
  refresh: ['M20 6v6h-6', 'M4 18v-6h6', 'M20 12a8 8 0 0 0-14.9-4', 'M4 12a8 8 0 0 0 14.9 4'],
  search: ['M21 21l-4.35-4.35', 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
  warning: ['M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01'],
  lock: ['M5 11h14v11H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  check: ['M20 6 9 17l-5-5'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z'],
  sun: ['M12 4V2', 'M12 22v-2', 'm4.93 4.93-1.42-1.42', 'm18.49 18.49-1.42-1.42', 'M4 12H2', 'M22 12h-2', 'm6.93 17.07-1.42 1.42', 'm18.49 5.51-1.42 1.42', 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
  database: ['M4 6c0 2 3.58 4 8 4s8-2 8-4-3.58-4-8-4-8 2-8 4Z', 'M4 6v6c0 2 3.58 4 8 4s8-2 8-4V6', 'M4 12v6c0 2 3.58 4 8 4s8-2 8-4v-6']
}
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    :aria-hidden="props.label ? undefined : 'true'"
    :role="props.label ? 'img' : undefined"
    focusable="false"
  >
    <title v-if="props.label">{{ props.label }}</title>
    <path v-for="path in icons[props.name] || icons.database" :key="path" :d="path" />
  </svg>
</template>
