/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_DEPLOYMENT_ENVIRONMENT?: 'development' | 'production'
  readonly VITE_ENABLE_DEVELOPMENT_CONTENT_INSPECTION?: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
