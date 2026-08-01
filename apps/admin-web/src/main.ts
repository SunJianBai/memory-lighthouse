import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router'
import { initializeTheme } from './state/theme'
import './styles/tokens.css'
import './styles/global.css'

initializeTheme()

createApp(App).use(router).mount('#app')
