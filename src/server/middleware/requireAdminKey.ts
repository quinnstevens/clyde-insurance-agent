import type { NextFunction, Request, Response } from 'express'
import { AppError } from '@clyde-api/types/errors'
import { isProduction } from '@clyde-api/utils/env'
import logger from '@clyde-api/utils/logger'
import { safeEqual } from '@clyde-api/utils/safeEqual'

/**
 * Guards the clinic management endpoints (the FAQ app) with `ADMIN_API_KEY`, sent as
 * `Authorization: Bearer <key>`. Separate from the Vapi secret, so the app's key can be rotated
 * without touching the phone agent.
 *
 * Like the tool secret: unset in production refuses everything, unset in development lets it through.
 */
export const requireAdminKey = (req: Request, _res: Response, next: NextFunction): void => {
  const expected = process.env.ADMIN_API_KEY
  const requestId = req.context?.requestId

  if (!expected) {
    if (isProduction) {
      logger.error('[requireAdminKey] ADMIN_API_KEY is not set; refusing admin request', { requestId })
      return next(AppError.unauthorized('Admin API is not configured', { requestId }))
    }
    return next()
  }

  const provided = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!provided || !safeEqual(provided, expected)) {
    return next(AppError.unauthorized('Invalid or missing admin key', { requestId }))
  }
  next()
}
