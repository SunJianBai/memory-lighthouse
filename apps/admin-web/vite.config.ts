import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: '/openBMB/admin/',
    plugins: [vue()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2022'
    },
    server: {
      proxy: {
        '/openBMB/api/v1': {
          target: env.ADMIN_API_PROXY_TARGET || 'http://127.0.0.1:13100',
          changeOrigin: true
        }
      }
    }
  }
})
