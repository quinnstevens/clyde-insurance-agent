import { z } from 'zod'
import { CLINIC_PROVIDER } from '@clyde-api/config/clinic'
import type { RequestContext } from '@clyde-api/types/context'
import { AppError } from '@clyde-api/types/errors'
import logger from '@clyde-api/utils/logger'

const ELIGIBILITY_URL = 'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3'
const TIMEOUT_MS = 15_000

/**
 * The slice of Stedi's eligibility (271) response we read. Everything is loose and optional: payers
 * fill these segments inconsistently, and an unexpected extra field must never fail a check.
 */
const BenefitSchema = z.looseObject({
  code: z.string().optional(),
  name: z.string().optional(),
  serviceTypeCodes: z.array(z.string()).optional(),
  coverageLevelCode: z.string().optional(),
  inPlanNetworkIndicatorCode: z.string().optional(),
  timeQualifierCode: z.string().optional(),
  benefitAmount: z.string().optional(),
  benefitPercent: z.string().optional(),
  planCoverage: z.string().optional(),
})

const PlanStatusSchema = z.looseObject({
  statusCode: z.string().optional(),
  status: z.string().optional(),
  planDetails: z.string().optional(),
  serviceTypeCodes: z.array(z.string()).optional(),
})

const PayerErrorSchema = z.looseObject({
  code: z.string().optional(),
  description: z.string().optional(),
  followupAction: z.string().optional(),
})

export const EligibilityResponseSchema = z.looseObject({
  planStatus: z.array(PlanStatusSchema).default([]),
  benefitsInformation: z.array(BenefitSchema).default([]),
  errors: z.array(PayerErrorSchema).default([]),
})

export type EligibilityBenefit = z.infer<typeof BenefitSchema>
export type EligibilityResponse = z.infer<typeof EligibilityResponseSchema>

export interface EligibilityRequest {
  payerId: string
  firstName: string
  lastName: string
  /** YYYY-MM-DD, as stored. Stedi wants YYYYMMDD; the client converts. */
  dateOfBirth: string
  memberId: string
  serviceTypeCode: string
}

/** Stedi wants a 9-digit control number per request; it only has to be unique enough to trace. */
const newControlNumber = () => String(Math.floor(100_000_000 + Math.random() * 900_000_000))

/**
 * Thin client for Stedi's real-time eligibility check. Throws `AppError`s; never logs the request or
 * response body, since both are full of PHI.
 */
export class StediClient {
  constructor(
    private readonly getApiKey: () => string | undefined = () => process.env.STEDI_API_KEY,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async checkEligibility(request: EligibilityRequest, ctx: RequestContext): Promise<EligibilityResponse> {
    const apiKey = this.getApiKey()
    if (!apiKey) {
      throw AppError.internal('STEDI_API_KEY is not set', undefined, { requestId: ctx.requestId })
    }

    const controlNumber = newControlNumber()
    const meta = { requestId: ctx.requestId, payerId: request.payerId, controlNumber }
    const startedAt = Date.now()

    let response: Response
    try {
      response = await this.fetchImpl(ELIGIBILITY_URL, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          controlNumber,
          tradingPartnerServiceId: request.payerId,
          provider: CLINIC_PROVIDER,
          subscriber: {
            firstName: request.firstName,
            lastName: request.lastName,
            dateOfBirth: request.dateOfBirth.replaceAll('-', ''),
            memberId: request.memberId,
          },
          encounter: { serviceTypeCodes: [request.serviceTypeCode] },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw AppError.timeout('Stedi eligibility check timed out', { ...meta, timeoutMs: TIMEOUT_MS })
      }
      throw AppError.externalApi('Stedi eligibility request failed', error as Error, meta)
    }

    const durationMs = Date.now() - startedAt
    if (!response.ok) {
      throw AppError.externalApi(`Stedi eligibility check returned ${response.status}`, undefined, {
        ...meta,
        status: response.status,
        durationMs,
      })
    }

    const parsed = EligibilityResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) {
      throw AppError.externalApi('Stedi eligibility response was not in the expected shape', parsed.error, meta)
    }

    logger.info('[StediClient] eligibility check completed', {
      ...meta,
      durationMs,
      payerErrorCodes: parsed.data.errors.map((e) => e.code),
    })
    return parsed.data
  }
}

export const stediClient = new StediClient()
