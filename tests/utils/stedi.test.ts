import { AppError } from '@clyde-api/types/errors'
import { StediClient, type EligibilityRequest } from '@clyde-api/utils/stedi'
import { loadStediFixture } from '../fixtures/stedi'

const request: EligibilityRequest = {
  payerId: '62308',
  firstName: 'James',
  lastName: 'Jones',
  dateOfBirth: '1991-02-02',
  memberId: '23456789100',
  serviceTypeCode: '30',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('StediClient', () => {
  const ctx = { requestId: 'test-request' }

  it('sends the eligibility request Stedi expects', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(loadStediFixture('james')))
    const client = new StediClient(() => 'test-key', fetchImpl)

    await client.checkEligibility(request, ctx)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'test-key' })

    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      tradingPartnerServiceId: '62308',
      provider: { npi: '1999999984' },
      subscriber: { firstName: 'James', lastName: 'Jones', dateOfBirth: '19910202', memberId: '23456789100' },
      encounter: { serviceTypeCodes: ['30'] },
    })
    expect(body.controlNumber).toMatch(/^\d{9}$/)
  })

  it('returns the parsed response', async () => {
    const client = new StediClient(
      () => 'test-key',
      jest.fn().mockResolvedValue(jsonResponse(loadStediFixture('morgan'))),
    )

    const response = await client.checkEligibility(request, ctx)

    expect(response.planStatus[0]).toMatchObject({ statusCode: '6', status: 'Inactive' })
  })

  it('throws internal_error when no API key is configured', async () => {
    const fetchImpl = jest.fn()
    const client = new StediClient(() => undefined, fetchImpl)

    await expect(client.checkEligibility(request, ctx)).rejects.toMatchObject({ code: 'internal_error' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws external_api_error on a non-2xx response', async () => {
    const client = new StediClient(
      () => 'test-key',
      jest.fn().mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, 401)),
    )

    const promise = client.checkEligibility(request, ctx)

    await expect(promise).rejects.toBeInstanceOf(AppError)
    await expect(promise).rejects.toMatchObject({ code: 'external_api_error', meta: { status: 401 } })
  })

  it('throws timeout when the request times out', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    const client = new StediClient(() => 'test-key', jest.fn().mockRejectedValue(timeout))

    await expect(client.checkEligibility(request, ctx)).rejects.toMatchObject({ code: 'timeout' })
  })

  it('throws external_api_error when the network call fails', async () => {
    const client = new StediClient(() => 'test-key', jest.fn().mockRejectedValue(new TypeError('fetch failed')))

    await expect(client.checkEligibility(request, ctx)).rejects.toMatchObject({ code: 'external_api_error' })
  })
})
