import type { EligibilityBenefit, EligibilityResponse } from '@clyde-api/utils/stedi'

export type CoverageStatus = 'active' | 'inactive' | 'unknown'

export interface CostShare {
  /** Flat dollar copay, when the payer lists one. */
  copay: number | null
  /** Whole percent, e.g. 10 for 10%. */
  coinsurancePercent: number | null
  /** Individual deductible for the plan year. */
  deductible: number | null
  /** What is left of that deductible, when the payer reports it. */
  deductibleRemaining: number | null
}

export interface EligibilitySummary {
  coverage: CoverageStatus
  planName: string | null
  costShare: CostShare
  /** Payer rejections (AAA segments), e.g. "Subscriber/Insured Not Found". */
  payerErrors: string[]
}

// X12 EB01 eligibility codes. 1-4 are flavours of active, 6-8 of inactive. 5 ("active, pending
// investigation") is deliberately neither: we would rather say "couldn't confirm" than guess.
const ACTIVE_CODES = new Set(['1', '2', '3', '4'])
const INACTIVE_CODES = new Set(['6', '7', '8'])

// EB01 cost-share codes.
const COINSURANCE = 'A'
const COPAY = 'B'
const DEDUCTIBLE = 'C'

// EB06 time qualifiers.
const CALENDAR_YEAR = '23'
const SERVICE_YEAR = '22'
const REMAINING = '29'

// EB12 in-plan-network indicator: Y = in network, W = not applicable (applies either way), N = out of
// network. The clinic is treated as in network, so N rows never count.
const NETWORK_PREFERENCE = ['Y', 'W', undefined]

const toNumber = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The best in-network, individual-level row for one cost-share code, or undefined. Rows with no
 * coverage level are treated as individual.
 */
const pickBenefit = (
  benefits: EligibilityBenefit[],
  code: string,
  timeQualifiers?: string[],
): EligibilityBenefit | undefined => {
  const candidates = benefits.filter(
    (b) =>
      b.code === code &&
      (b.coverageLevelCode ?? 'IND') === 'IND' &&
      (timeQualifiers === undefined || timeQualifiers.includes(b.timeQualifierCode ?? '')),
  )
  for (const network of NETWORK_PREFERENCE) {
    const match = candidates.find((b) => b.inPlanNetworkIndicatorCode === network)
    if (match) return match
  }
  return undefined
}

/**
 * Reduce a Stedi eligibility response to the handful of facts the phone agent needs, for one service
 * type. Pure: no I/O, so it is tested directly against recorded sandbox responses.
 */
export const summarizeEligibility = (response: EligibilityResponse, serviceTypeCode: string): EligibilitySummary => {
  const forService = response.benefitsInformation.filter((b) => b.serviceTypeCodes?.includes(serviceTypeCode))
  const statuses = response.planStatus.filter((s) => s.serviceTypeCodes?.includes(serviceTypeCode))

  const statusCodes = [...statuses.map((s) => s.statusCode), ...forService.map((b) => b.code)].filter(
    (c): c is string => c !== undefined,
  )

  const coverage: CoverageStatus = statusCodes.some((c) => ACTIVE_CODES.has(c))
    ? 'active'
    : statusCodes.some((c) => INACTIVE_CODES.has(c))
      ? 'inactive'
      : 'unknown'

  const planName =
    forService.find((b) => b.code !== undefined && ACTIVE_CODES.has(b.code) && b.planCoverage)?.planCoverage ??
    statuses.find((s) => s.planDetails)?.planDetails ??
    null

  const coinsurance = toNumber(pickBenefit(forService, COINSURANCE)?.benefitPercent)

  return {
    coverage,
    planName,
    costShare: {
      copay: toNumber(pickBenefit(forService, COPAY)?.benefitAmount),
      // Stedi sends coinsurance as a fraction ("0.1"); round away float noise like 10.000000000000002.
      coinsurancePercent: coinsurance === null ? null : Math.round(coinsurance * 10000) / 100,
      deductible: toNumber(pickBenefit(forService, DEDUCTIBLE, [CALENDAR_YEAR, SERVICE_YEAR])?.benefitAmount),
      deductibleRemaining: toNumber(pickBenefit(forService, DEDUCTIBLE, [REMAINING])?.benefitAmount),
    },
    payerErrors: response.errors.map((e) => e.description ?? e.code ?? 'Unknown payer error'),
  }
}
