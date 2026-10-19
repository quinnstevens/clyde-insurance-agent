import { summarizeEligibility } from '@clyde-api/server/controllers/eligibility/summarizeEligibility'
import { loadStediFixture } from '../../fixtures/stedi'

describe('summarizeEligibility', () => {
  describe('against recorded Stedi sandbox responses', () => {
    it('James (Cigna): active, no flat copay, in-network individual deductible and coinsurance', () => {
      const summary = summarizeEligibility(loadStediFixture('james'), '30')

      expect(summary).toEqual({
        coverage: 'active',
        planName: 'Open Access Plus',
        // The only copay in the response is $35 for prescriptions (service types 89/91), not type 30.
        // The $7,500 out-of-network deductible and family rows must not leak in either.
        costShare: { copay: null, coinsurancePercent: 10, deductible: 250, deductibleRemaining: null },
        payerErrors: [],
      })
    })

    it('Jane (Humana): active, with deductible remaining read from the Remaining row', () => {
      const summary = summarizeEligibility(loadStediFixture('jane'), '30')

      expect(summary.coverage).toBe('active')
      expect(summary.planName).toBe('Humana Gold Plan')
      expect(summary.costShare.deductible).toBe(250)
      expect(summary.costShare.deductibleRemaining).toBe(0)
      expect(summary.payerErrors).toEqual([])
    })

    it('Morgan (UHC): inactive', () => {
      const summary = summarizeEligibility(loadStediFixture('morgan'), '30')

      expect(summary.coverage).toBe('inactive')
      expect(summary.costShare).toEqual({
        copay: null,
        coinsurancePercent: null,
        deductible: null,
        deductibleRemaining: null,
      })
    })
  })

  describe('edge cases', () => {
    const empty = { planStatus: [], benefitsInformation: [], errors: [] }

    it('is unknown when nothing mentions the service type', () => {
      const summary = summarizeEligibility(
        { ...empty, benefitsInformation: [{ code: '1', serviceTypeCodes: ['88'] }] },
        '30',
      )

      expect(summary.coverage).toBe('unknown')
    })

    it('treats "active, pending investigation" (5) as unknown rather than active', () => {
      const summary = summarizeEligibility(
        { ...empty, planStatus: [{ statusCode: '5', serviceTypeCodes: ['30'] }] },
        '30',
      )

      expect(summary.coverage).toBe('unknown')
    })

    it('reports an in-network copay and ignores the out-of-network one', () => {
      const summary = summarizeEligibility(
        {
          ...empty,
          benefitsInformation: [
            { code: '1', serviceTypeCodes: ['30'] },
            { code: 'B', serviceTypeCodes: ['30'], inPlanNetworkIndicatorCode: 'N', benefitAmount: '80' },
            { code: 'B', serviceTypeCodes: ['30'], inPlanNetworkIndicatorCode: 'Y', benefitAmount: '25' },
          ],
        },
        '30',
      )

      expect(summary.costShare.copay).toBe(25)
    })

    it('surfaces payer rejections', () => {
      const summary = summarizeEligibility(
        { ...empty, errors: [{ code: '75', description: 'Subscriber/Insured Not Found' }] },
        '30',
      )

      expect(summary.payerErrors).toEqual(['Subscriber/Insured Not Found'])
    })
  })
})
