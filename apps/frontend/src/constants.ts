export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

export const API_CONFIG = {
  TIMEOUT: 30000,
  RETRY_POLICY: {
    MAX_ATTEMPTS: 3,
    BASE_DELAY: 1000,
  },
}
