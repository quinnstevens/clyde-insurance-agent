import cors from 'cors'
import { isProduction } from '@clyde-api/utils/env'

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// An entry like `https://*.lovable.app` allows any subdomain (Lovable gives every preview its own).
const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
const originPatterns = allowedOrigins.map(
  (origin) => new RegExp(`^${origin.split('*').map(escapeRegExp).join('[a-z0-9-]+(?:\\.[a-z0-9-]+)*')}$`, 'i'),
)

export const isAllowedOrigin = (origin: string): boolean => originPatterns.some((pattern) => pattern.test(origin))

export default () =>
  cors({
    origin: (origin, callback) => {
      // Development: allow all origins (echoes back Origin header, compatible with credentials)
      if (!isProduction) return callback(null, true)

      // Production: strict allowlist from CORS_ORIGINS
      if (!origin) return callback(null, true) // allow non-browser requests (curl, server-to-server)

      if (isAllowedOrigin(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS: Origin ${origin} not allowed`), false)
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

export const useCors = process.env.USE_CORS === 'true'
