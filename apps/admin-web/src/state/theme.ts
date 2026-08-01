import { ref } from 'vue'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'memory-lighthouse-admin-theme'
export const currentTheme = ref<Theme>('light')

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  currentTheme.value = theme
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme(): void {
  applyTheme(preferredTheme())
}

export function toggleTheme(): void {
  const next = currentTheme.value === 'light' ? 'dark' : 'light'
  window.localStorage.setItem(STORAGE_KEY, next)
  applyTheme(next)
}
