import { acceptedPayerList } from '@clyde-api/config/clinic'
import type { CostShare } from './summarizeEligibility'

const dollars = (amount: number) => `$${amount.toLocaleString('en-US')}`

/**
 * What the caller can expect to pay, built only from numbers the payer returned. Never estimates:
 * when the payer lists nothing usable, it says so and points to the front desk.
 */
const costShareSentence = ({ copay, coinsurancePercent, deductible, deductibleRemaining }: CostShare): string => {
  if (copay !== null) return `Your copay for a visit should be ${dollars(copay)}.`

  const deductiblePart =
    deductible === null
      ? null
      : deductibleRemaining === null
        ? `a ${dollars(deductible)} deductible`
        : `a ${dollars(deductible)} deductible, with ${dollars(deductibleRemaining)} of it left to meet`

  if (coinsurancePercent !== null && deductiblePart !== null)
    return `Your plan doesn't list a flat copay. Instead, you pay ${coinsurancePercent} percent of the cost after ${deductiblePart}.`
  if (coinsurancePercent !== null)
    return `Your plan doesn't list a flat copay. Instead, you pay ${coinsurancePercent} percent of the cost.`
  if (deductiblePart !== null)
    return `Your plan doesn't list a flat copay, and it has ${deductiblePart}. Our front desk can go over what a visit will cost.`
  return `Your plan didn't list a copay, so our front desk can go over what a visit will cost.`
}

/**
 * What the agent says for each outcome. Kept in one place so wording can be reviewed (and changed)
 * without touching the decision logic. Written to be spoken: short sentences, no abbreviations.
 */
export const messages = {
  // Leads with "you're all set", per the clinic's expected answer, then what they'll pay.
  acceptedActive: (name: string, payer: string, costShare: CostShare) =>
    `Thanks, ${name}. We accept ${payer} and your coverage is active, so you're all set. ${costShareSentence(costShare)}`,

  notAcceptedActive: (name: string, payer: string) =>
    `Thanks, ${name}. Your ${payer} coverage is active, but unfortunately our clinic doesn't accept ${payer}. ` +
    `We accept ${acceptedPayerList()}. You're still welcome to be seen as a self-pay patient, ` +
    `and our front desk can go over self-pay pricing with you.`,

  acceptedInactive: (name: string, payer: string) =>
    `Thanks, ${name}. We do accept ${payer}, but the ${payer} plan we have on file for you is showing as inactive. ` +
    `That usually means the plan ended or changed. Please check with ${payer} or your employer, ` +
    `and if you have a new insurance card, our front desk can update it for you.`,

  notAcceptedInactive: (name: string, payer: string) =>
    `Thanks, ${name}. The ${payer} plan we have on file for you is showing as inactive, and our clinic also doesn't accept ${payer}. ` +
    `We accept ${acceptedPayerList()}. If you have newer insurance, our front desk can update it for you.`,

  // Same wording whether the name or the date of birth was wrong, so callers can't probe who's a patient.
  unknownCaller: () =>
    `I'm sorry, I couldn't find a patient with that name and date of birth. Could you tell me your first name and date of birth again?`,

  verified: (name: string) => `Thanks, ${name}, I found your record. How can I help you today?`,

  // Read by the model. Without this it tends to run straight on into an insurance check.
  verifiedNextStep:
    "Say 'say' and then stop and wait for the caller to tell you what they need. Do not call check_insurance or " +
    'answer_question until the caller asks for something.',

  notVerifiedNextStep:
    "Say 'say' and wait for their answer. Try verify_caller once more with what they tell you. If it fails again, " +
    'tell them the front desk will need to help with their account; you can still answer general clinic questions.',

  ambiguousNextStep: "Say 'say'. Don't check their insurance; you can still answer general clinic questions.",

  ambiguousCaller: () =>
    `I found more than one patient with that name and date of birth. To make sure I look up the right person, our front desk will need to help with this one.`,

  noInsuranceOnFile: (name: string) =>
    `Thanks, ${name}. I found your record, but we don't have any insurance on file for you yet, so I can't check your coverage. Our front desk can add your insurance for you.`,

  checkFailed: (name: string, payer: string) =>
    `Thanks, ${name}. I wasn't able to confirm your coverage with ${payer} right now. ` +
    `Rather than guess, I'd like our front desk to confirm it for you.`,
}
