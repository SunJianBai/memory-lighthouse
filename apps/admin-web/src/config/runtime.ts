const explicitApiBase = import.meta.env.VITE_API_BASE?.trim().replace(/\/$/, '')

export const API_BASE = explicitApiBase || '/openBMB/api/v1'

export const deploymentEnvironment =
  import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase() || 'production'

export const contentInspectionEnabled =
  deploymentEnvironment === 'development' &&
  import.meta.env.VITE_ENABLE_DEVELOPMENT_CONTENT_INSPECTION === 'true'
