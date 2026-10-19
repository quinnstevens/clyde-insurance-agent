import { acceptedPayerList } from '@clyde-api/config/clinic'
import type { CostShare } from './summarizeEligibility'

/**
 * What the agent says for each outcome. Kept in one place so wording can be reviewed (and changed)
 * without touching the decision logic. Written to be spoken: short sentences, no abbreviations.
 */

const money = (amount: number): string =>
  Number.isInteger(amount) ? `$${amount.toLocaleString('en-US')}` : `$${amount.toFixed(2)}`

export const describeCostShare = (costShare: CostShare): string => {
  const { copay, coinsurancePercent, deductible, deductibleRemaining } = costShare

  if (copay !== null) return `Your copay for this visit should be ${money(copay)}.`

  if (deductible !== null) {
    const remaining = deductibleRemaining !== null ? `, with ${money(deductibleRemaining)} left to meet this year` : ''
    const after =
      coinsurancePercent !== null ? `, and after that you pay ${coinsurancePercent} percent coinsurance.` : '.'
    return `Your plan doesn't list a flat copay for this visit. Instead you have a ${money(deductible)} deductible${remaining}${after}`
  }

  if (coinsurancePercent !== null) {
    return `Your plan doesn't list a flat copay for this visit. Instead you pay ${coinsurancePercent} percent coinsurance.`
  }

  return `Your plan didn't list cost details for this visit, so the front desk will confirm your cost when you check in.`
}

export const messages = {
  acceptedActive: (name: string, payer: string, costShare: CostShare) =>
    `Thanks, ${name}. We accept ${payer} and your coverage is active, so you're all set. ${describeCostShare(costShare)}`,

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

  unknownCaller: () =>
    `I'm sorry, I couldn't find a patient by that name in our records. Could you tell me your first name again, or spell it for me?`,

  ambiguousCaller: () =>
    `I found more than one patient with that name. To make sure I look up the right person, our front desk will need to help with this one.`,

  noInsuranceOnFile: (name: string) =>
    `Thanks, ${name}. I found your record, but we don't have any insurance on file for you yet, so I can't check your coverage. Our front desk can add your insurance for you.`,

  checkFailed: (name: string, payer: string) =>
    `Thanks, ${name}. I wasn't able to confirm your coverage with ${payer} right now. ` +
    `Rather than guess, I'd like our front desk to confirm it for you.`,
}
