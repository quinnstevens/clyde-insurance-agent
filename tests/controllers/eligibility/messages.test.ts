import { messages } from '@clyde-api/server/controllers/eligibility/messages'
import type { CostShare } from '@clyde-api/server/controllers/eligibility/summarizeEligibility'

describe('messages.acceptedActive', () => {
  const none: CostShare = { copay: null, coinsurancePercent: null, deductible: null, deductibleRemaining: null }
  const say = (costShare: Partial<CostShare>) => messages.acceptedActive('James', 'Cigna', { ...none, ...costShare })

  it('gives the copay when the payer lists one', () => {
    expect(say({ copay: 35, coinsurancePercent: 10 })).toContain('Your copay for a visit should be $35.')
  })

  it('falls back to coinsurance and the deductible when there is no copay', () => {
    expect(say({ coinsurancePercent: 10, deductible: 250 })).toContain(
      'you pay 10 percent of the cost after a $250 deductible.',
    )
  })

  it('includes what is left of the deductible when the payer reports it', () => {
    expect(say({ coinsurancePercent: 20, deductible: 1500, deductibleRemaining: 400 })).toContain(
      'after a $1,500 deductible, with $400 of it left to meet.',
    )
  })

  it('sends cost questions to the front desk when the payer lists nothing', () => {
    expect(say({})).toContain('our front desk can go over what a visit will cost.')
  })

  it('still leads with "you\'re all set"', () => {
    expect(say({ copay: 35 })).toMatch(/^Thanks, James\. We accept Cigna and your coverage is active, so you're all set\. /)
  })
})
