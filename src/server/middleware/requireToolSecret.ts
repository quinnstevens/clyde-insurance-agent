import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { AppError } from '@clyde-api/types/errors'
import { isProduction } from '@clyde-api/utils/env'
import logger from '@clyde-api/utils/logger'

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Guards the tool endpoints with the shared secret configured on the Vapi tool. Vapi can send it as
 * `x-vapi-secret` or as a bearer token (a "Bearer Token" credential), so either is accepted.
 *
 * Without `VAPI_TOOL_SECRET` set, production refuses every request; development lets them through so
 * the endpoints can be poked with curl.
 */
export const requireToolSecret = (req: Request, _res: Response, next: NextFunction): void => {
  const expected = process.env.VAPI_TOOL_SECRET
  const requestId = req.context?.requestId

  if (!expected) {
    if (isProduction) {
      logger.error('[requireToolSecret] VAPI_TOOL_SECRET is not set; refusing tool request', { requestId })
      return next(AppError.unauthorized('Tool endpoint is not configured', { requestId }))
    }
    return next()
  }

  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  const provided = req.get('x-vapi-secret') ?? bearer

  if (!provided || !safeEqual(provided, expected)) {
    return next(AppError.unauthorized('Invalid or missing tool secret', { requestId }))
  }
  next()
}
