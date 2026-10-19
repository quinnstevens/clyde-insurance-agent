import { EligibilityController } from '@clyde-api/server/controllers/eligibility/EligibilityController'
import Patient from '@clyde-api/models/patient'
import { AppError } from '@clyde-api/types/errors'
import { loadStediFixture, type StediFixture } from '../../fixtures/stedi'

jest.mock('@clyde-api/models/patient')

const patients = {
  james: {
    id: '6f1c1d2e-0000-4000-8000-000000000001',
    preferred_name: 'James',
    first_name: 'James',
    last_name: 'Jones',
    date_of_birth: '1991-02-02',
    insurance_member_id: '23456789100',
    insurance_payer_id: '62308',
    insurance_payer_name: 'Cigna',
  },
  jane: {
    id: '6f1c1d2e-0000-4000-8000-000000000002',
    preferred_name: 'Jane',
    first_name: 'Jane',
    last_name: 'Doe',
    date_of_birth: '1975-05-05',
    insurance_member_id: 'HUMANA123',
    insurance_payer_id: '61101',
    insurance_payer_name: 'Humana',
  },
  morgan: {
    id: '6f1c1d2e-0000-4000-8000-000000000003',
    preferred_name: 'Morgan',
    first_name: 'Jane',
    last_name: 'Doe',
    date_of_birth: '1971-01-01',
    insurance_member_id: 'UHCINACTIVE',
    insurance_payer_id: '87726',
    insurance_payer_name: 'UnitedHealthcare',
  },
}

/**
 * Stand-in for `Patient.query().where(...).limit(...)`. Each query resolves to the next entry in
 * `results`, so a test can script the full-name lookup and then the first-word fallback.
 */
const mockPatientQueries = (...results: unknown[][]) => {
  const builders = results.map((result) => {
    const builder: any = {
      where: jest.fn(() => builder),
      limit: jest.fn(() => builder),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    }
    return builder
  })
  const query = Patient.query as jest.Mock
  builders.forEach((builder) => query.mockReturnValueOnce(builder))
  return builders
}

describe('EligibilityController', () => {
  const ctx = { requestId: 'test-request' }
  const stedi = { checkEligibility: jest.fn() }
  const controller = new EligibilityController(stedi)

  const respondWith = (fixture: StediFixture) => stedi.checkEligibility.mockResolvedValue(loadStediFixture(fixture))

  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('the three test callers', () => {
    it('James: Cigna is accepted and active, so he is all set', async () => {
      mockPatientQueries([patients.james])
      respondWith('james')

      const result = await controller.checkByCallerName({ caller_name: 'James' }, ctx)

      expect(stedi.checkEligibility).toHaveBeenCalledWith(
        {
          payerId: '62308',
          firstName: 'James',
          lastName: 'Jones',
          dateOfBirth: '1991-02-02',
          memberId: '23456789100',
          serviceTypeCode: '30',
        },
        ctx,
      )
      expect(result).toMatchObject({
        outcome: 'accepted_active',
        patient_id: patients.james.id,
        payer_name: 'Cigna',
        payer_accepted: true,
        coverage: 'active',
        plan_name: 'Open Access Plus',
        cost_share: { copay: null, coinsurance_percent: 10, deductible: 250, deductible_remaining: null },
      })
      expect(result.say).toContain("you're all set")
      expect(result.say).toContain('$250 deductible')
      expect(result.say).toContain('10 percent coinsurance')
    })

    it('Jane: Humana is active but not accepted', async () => {
      mockPatientQueries([patients.jane])
      respondWith('jane')

      const result = await controller.checkByCallerName({ caller_name: 'Jane' }, ctx)

      expect(stedi.checkEligibility).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        outcome: 'not_accepted_active',
        payer_name: 'Humana',
        payer_accepted: false,
        coverage: 'active',
      })
      expect(result.say).toContain("doesn't accept Humana")
      expect(result.say).toContain('Aetna, Cigna, or UnitedHealthcare')
    })

    it('Morgan: UnitedHealthcare is accepted but the coverage is inactive, checked as Jane Doe', async () => {
      mockPatientQueries([patients.morgan])
      respondWith('morgan')

      const result = await controller.checkByCallerName({ caller_name: 'Morgan' }, ctx)

      expect(stedi.checkEligibility).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Jane', lastName: 'Doe', memberId: 'UHCINACTIVE', payerId: '87726' }),
        ctx,
      )
      expect(result).toMatchObject({
        outcome: 'accepted_inactive',
        payer_name: 'UnitedHealthcare',
        payer_accepted: true,
        coverage: 'inactive',
      })
      expect(result.say).toContain('We do accept UnitedHealthcare')
      expect(result.say).toContain('inactive')
    })
  })

  describe('caller lookup', () => {
    it('matches preferred_name case-insensitively', async () => {
      const [builder] = mockPatientQueries([patients.james])
      respondWith('james')

      await controller.checkByCallerName({ caller_name: 'james' }, ctx)

      expect(builder.where).toHaveBeenCalledWith('preferred_name', 'ilike', 'james')
    })

    it('falls back to the first word when the caller gives a full name', async () => {
      const [fullName, firstWord] = mockPatientQueries([], [patients.james])
      respondWith('james')

      const result = await controller.checkByCallerName({ caller_name: 'James Jones' }, ctx)

      expect(fullName.where).toHaveBeenCalledWith('preferred_name', 'ilike', 'James Jones')
      expect(firstWord.where).toHaveBeenCalledWith('preferred_name', 'ilike', 'James')
      expect(result.outcome).toBe('accepted_active')
    })

    it('strips punctuation and LIKE wildcards before querying', async () => {
      const [builder] = mockPatientQueries([patients.james])
      respondWith('james')

      await controller.checkByCallerName({ caller_name: 'Ja%m_es.' }, ctx)

      expect(builder.where).toHaveBeenCalledWith('preferred_name', 'ilike', 'James')
    })

    it('returns unknown_caller without calling Stedi for a name it does not know', async () => {
      mockPatientQueries([])

      const result = await controller.checkByCallerName({ caller_name: 'Bob' }, ctx)

      expect(stedi.checkEligibility).not.toHaveBeenCalled()
      expect(result).toMatchObject({ outcome: 'unknown_caller', patient_id: null, coverage: null })
      expect(result.say).toContain("couldn't find a patient")
    })

    it('returns unknown_caller when nothing usable is left of the name', async () => {
      const result = await controller.checkByCallerName({ caller_name: '123 ...' }, ctx)

      expect(Patient.query).not.toHaveBeenCalled()
      expect(result.outcome).toBe('unknown_caller')
    })

    it('refuses to guess when a name matches more than one patient', async () => {
      mockPatientQueries([patients.james, { ...patients.james, id: 'other' }])

      const result = await controller.checkByCallerName({ caller_name: 'James' }, ctx)

      expect(stedi.checkEligibility).not.toHaveBeenCalled()
      expect(result.outcome).toBe('ambiguous_caller')
    })

    it('returns no_insurance_on_file when the patient has no member id', async () => {
      mockPatientQueries([{ ...patients.james, insurance_member_id: null }])

      const result = await controller.checkByCallerName({ caller_name: 'James' }, ctx)

      expect(stedi.checkEligibility).not.toHaveBeenCalled()
      expect(result).toMatchObject({ outcome: 'no_insurance_on_file', patient_id: patients.james.id })
    })
  })

  describe('when Stedi cannot answer', () => {
    it('returns check_failed instead of guessing when Stedi errors', async () => {
      mockPatientQueries([patients.james])
      stedi.checkEligibility.mockRejectedValue(AppError.timeout('Stedi eligibility check timed out'))

      const result = await controller.checkByCallerName({ caller_name: 'James' }, ctx)

      expect(result).toMatchObject({ outcome: 'check_failed', coverage: 'unknown', cost_share: null })
      expect(result.say).toContain("wasn't able to confirm")
    })

    it('returns check_failed when the payer rejects the request', async () => {
      mockPatientQueries([patients.james])
      stedi.checkEligibility.mockResolvedValue({
        planStatus: [],
        benefitsInformation: [],
        errors: [{ code: '75', description: 'Subscriber/Insured Not Found' }],
      })

      const result = await controller.checkByCallerName({ caller_name: 'James' }, ctx)

      expect(result.outcome).toBe('check_failed')
    })

    it('lets unexpected (non-AppError) errors propagate', async () => {
      mockPatientQueries([patients.james])
      stedi.checkEligibility.mockRejectedValue(new TypeError('bug'))

      await expect(controller.checkByCallerName({ caller_name: 'James' }, ctx)).rejects.toThrow('bug')
    })
  })
})
