import { z } from 'zod'

/** Arguments for the `check_insurance` tool (and POST /eligibility/check). */
export const CheckInsuranceParamsSchema = z.object({
  caller_name: z
    .string({ error: 'caller_name is required' })
    .trim()
    .min(1, 'caller_name is required')
    .max(100, 'caller_name must be at most 100 characters'),
})

export type CheckInsuranceParams = z.infer<typeof CheckInsuranceParamsSchema>

/**
 * Every way a check can end. The agent branches on this; `say` carries the exact wording so the
 * facts in the answer come from code, not from the model.
 */
export const EligibilityOutcomeSchema = z.enum([
  'accepted_active',
  'not_accepted_active',
  'accepted_inactive',
  'not_accepted_inactive',
  'unknown_caller',
  'ambiguous_caller',
  'no_insurance_on_file',
  'check_failed',
])

export type EligibilityOutcome = z.infer<typeof EligibilityOutcomeSchema>

export const CostShareResultSchema = z.object({
  copay: z.number().nullable(),
  coinsurance_percent: z.number().nullable(),
  deductible: z.number().nullable(),
  deductible_remaining: z.number().nullable(),
})

export const EligibilityCheckResultSchema = z.object({
  outcome: EligibilityOutcomeSchema,
  patient_id: z.string().nullable(),
  payer_name: z.string().nullable(),
  payer_accepted: z.boolean().nullable(),
  coverage: z.enum(['active', 'inactive', 'unknown']).nullable(),
  plan_name: z.string().nullable(),
  cost_share: CostShareResultSchema.nullable(),
  /** One or two sentences, ready for the voice agent to read out verbatim. */
  say: z.string(),
})

export type EligibilityCheckResult = z.infer<typeof EligibilityCheckResultSchema>
