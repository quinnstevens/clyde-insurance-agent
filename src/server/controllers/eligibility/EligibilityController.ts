import { ACCEPTED_PAYERS, ELIGIBILITY_SERVICE_TYPE_CODE, isAcceptedPayer } from '@clyde-api/config/clinic'
import Patient from '@clyde-api/models/patient'
import type { RequestContext } from '@clyde-api/types/context'
import { AppError } from '@clyde-api/types/errors'
import logger from '@clyde-api/utils/logger'
import { stediClient, type StediClient } from '@clyde-api/utils/stedi'
import { messages } from './messages'
import type { CheckInsuranceParams, EligibilityCheckResult, EligibilityOutcome } from './schemas'
import { summarizeEligibility, type EligibilitySummary } from './summarizeEligibility'

type CallerMatch = { kind: 'found'; patient: Patient } | { kind: 'unknown' } | { kind: 'ambiguous' }

/**
 * Keep letters, spaces, hyphens and apostrophes. Besides tidying speech-to-text output ("James."),
 * this strips `%` and `_`, which would otherwise act as wildcards in the ILIKE lookup.
 */
const normalizeName = (raw: string): string =>
  raw
    .replace(/[^\p{L}\s'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

const emptyResult = (outcome: EligibilityOutcome, say: string): EligibilityCheckResult => ({
  outcome,
  patient_id: null,
  payer_name: null,
  payer_accepted: null,
  coverage: null,
  plan_name: null,
  cost_share: null,
  say,
})

/**
 * Answers "is my insurance accepted here, and what will I pay?" for a caller identified by name.
 *
 * Every expected failure (unknown name, payer rejection, Stedi down) comes back as an `outcome` with a
 * sentence to say rather than a thrown error: the voice agent always needs something true to tell
 * the caller.
 */
export class EligibilityController {
  constructor(private readonly stedi: Pick<StediClient, 'checkEligibility'> = stediClient) {}

  async checkByCallerName(params: CheckInsuranceParams, ctx: RequestContext): Promise<EligibilityCheckResult> {
    const match = await this.findCaller(params.caller_name)

    if (match.kind === 'unknown') {
      logger.info('[EligibilityController] caller not found', { requestId: ctx.requestId })
      return emptyResult('unknown_caller', messages.unknownCaller())
    }
    if (match.kind === 'ambiguous') {
      logger.warn('[EligibilityController] caller name matched several patients', { requestId: ctx.requestId })
      return emptyResult('ambiguous_caller', messages.ambiguousCaller())
    }

    const { patient } = match
    const name = patient.preferred_name ?? patient.first_name
    const logMeta = { requestId: ctx.requestId, patientId: patient.id, payerId: patient.insurance_payer_id }

    if (!patient.insurance_member_id || !patient.insurance_payer_id) {
      logger.info('[EligibilityController] no insurance on file', logMeta)
      return { ...emptyResult('no_insurance_on_file', messages.noInsuranceOnFile(name)), patient_id: patient.id }
    }

    const payerId = patient.insurance_payer_id
    const payerName = ACCEPTED_PAYERS[payerId] ?? patient.insurance_payer_name ?? 'your insurance company'
    const payerAccepted = isAcceptedPayer(payerId)

    let summary: EligibilitySummary
    try {
      const response = await this.stedi.checkEligibility(
        {
          payerId,
          firstName: patient.first_name,
          lastName: patient.last_name,
          dateOfBirth: patient.date_of_birth,
          memberId: patient.insurance_member_id,
          serviceTypeCode: ELIGIBILITY_SERVICE_TYPE_CODE,
        },
        ctx,
      )
      summary = summarizeEligibility(response, ELIGIBILITY_SERVICE_TYPE_CODE)
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      logger.warn('[EligibilityController] eligibility check failed', { ...logMeta, errorCode: error.code })
      return this.failed(patient, name, payerName, payerAccepted)
    }

    if (summary.payerErrors.length > 0 || summary.coverage === 'unknown') {
      logger.warn('[EligibilityController] payer could not confirm coverage', {
        ...logMeta,
        coverage: summary.coverage,
        payerErrorCount: summary.payerErrors.length,
      })
      return this.failed(patient, name, payerName, payerAccepted)
    }

    const active = summary.coverage === 'active'
    const [outcome, say]: [EligibilityOutcome, string] = payerAccepted
      ? active
        ? ['accepted_active', messages.acceptedActive(name, payerName)]
        : ['accepted_inactive', messages.acceptedInactive(name, payerName)]
      : active
        ? ['not_accepted_active', messages.notAcceptedActive(name, payerName)]
        : ['not_accepted_inactive', messages.notAcceptedInactive(name, payerName)]

    logger.info('[EligibilityController] eligibility checked', { ...logMeta, outcome, coverage: summary.coverage })

    return {
      outcome,
      patient_id: patient.id,
      payer_name: payerName,
      payer_accepted: payerAccepted,
      coverage: summary.coverage,
      plan_name: summary.planName,
      cost_share: {
        copay: summary.costShare.copay,
        coinsurance_percent: summary.costShare.coinsurancePercent,
        deductible: summary.costShare.deductible,
        deductible_remaining: summary.costShare.deductibleRemaining,
      },
      say,
    }
  }

  /**
   * Match on `preferred_name`, case-insensitively. Try the whole name first ("Mary Ann"), then just the
   * first word, so "James Jones" still finds James.
   */
  private async findCaller(rawName: string): Promise<CallerMatch> {
    const fullName = normalizeName(rawName)
    const firstWord = fullName.split(' ')[0]
    const keys = [...new Set([fullName, firstWord])].filter((key) => key.length > 0)

    for (const key of keys) {
      const patients = await Patient.query().where('preferred_name', 'ilike', key).limit(2)
      if (patients.length === 1) return { kind: 'found', patient: patients[0] }
      if (patients.length > 1) return { kind: 'ambiguous' }
    }
    return { kind: 'unknown' }
  }

  private failed(patient: Patient, name: string, payerName: string, payerAccepted: boolean): EligibilityCheckResult {
    return {
      ...emptyResult('check_failed', messages.checkFailed(name, payerName)),
      patient_id: patient.id,
      payer_name: payerName,
      payer_accepted: payerAccepted,
      coverage: 'unknown',
    }
  }
}

export const eligibilityController = new EligibilityController()
