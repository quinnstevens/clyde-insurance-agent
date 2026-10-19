import type { EligibilityCheckResult } from '@clyde-api/server/controllers/eligibility/schemas'
import { VapiToolController } from '@clyde-api/server/controllers/vapi/VapiToolController'

const result: EligibilityCheckResult = {
  outcome: 'unknown_caller',
  patient_id: null,
  payer_name: null,
  payer_accepted: null,
  coverage: null,
  plan_name: null,
  cost_share: null,
  say: "I'm sorry, I couldn't find a patient by that name.",
}

describe('VapiToolController', () => {
  const ctx = { requestId: 'test-request' }
  const eligibility = { checkByCallerName: jest.fn() }
  const controller = new VapiToolController(eligibility)

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('runs check_insurance and returns the result as a JSON string', async () => {
    eligibility.checkByCallerName.mockResolvedValue(result)

    const results = await controller.handleToolCalls(
      [{ id: 'call-1', function: { name: 'check_insurance', arguments: { caller_name: 'Bob' } } }],
      ctx,
    )

    expect(eligibility.checkByCallerName).toHaveBeenCalledWith({ caller_name: 'Bob' }, ctx)
    expect(results).toEqual([{ toolCallId: 'call-1', result: JSON.stringify(result) }])
  })

  it('accepts arguments sent as a JSON string', async () => {
    eligibility.checkByCallerName.mockResolvedValue(result)

    await controller.handleToolCalls(
      [{ id: 'call-1', function: { name: 'check_insurance', arguments: '{"caller_name":"Bob"}' } }],
      ctx,
    )

    expect(eligibility.checkByCallerName).toHaveBeenCalledWith({ caller_name: 'Bob' }, ctx)
  })

  it('returns an error for missing arguments without calling the check', async () => {
    const results = await controller.handleToolCalls(
      [{ id: 'call-1', function: { name: 'check_insurance', arguments: {} } }],
      ctx,
    )

    expect(eligibility.checkByCallerName).not.toHaveBeenCalled()
    expect(results[0]).toEqual({ toolCallId: 'call-1', error: expect.stringContaining('first name') })
  })

  it('returns an error for an unknown tool', async () => {
    const results = await controller.handleToolCalls([{ id: 'call-1', function: { name: 'book_visit' } }], ctx)

    expect(results[0]).toEqual({ toolCallId: 'call-1', error: 'Unknown tool "book_visit".' })
  })

  it('turns an unexpected failure into an instruction not to guess', async () => {
    eligibility.checkByCallerName.mockRejectedValue(new Error('database down'))

    const results = await controller.handleToolCalls(
      [{ id: 'call-1', function: { name: 'check_insurance', arguments: { caller_name: 'James' } } }],
      ctx,
    )

    expect(results[0].result).toBeUndefined()
    expect(results[0].error).toContain('Do not guess')
    expect(results[0].error).not.toContain('database')
  })

  it('answers every call in a batch, matched by id', async () => {
    eligibility.checkByCallerName.mockResolvedValue(result)

    const results = await controller.handleToolCalls(
      [
        { id: 'a', function: { name: 'check_insurance', arguments: { caller_name: 'Bob' } } },
        { id: 'b', function: { name: 'nope' } },
      ],
      ctx,
    )

    expect(results.map((r) => r.toolCallId)).toEqual(['a', 'b'])
  })
})
