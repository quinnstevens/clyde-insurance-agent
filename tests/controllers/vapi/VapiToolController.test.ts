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
  const faqs = { answer: jest.fn() }
  const controller = new VapiToolController(eligibility, faqs)

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

  describe('answer_question', () => {
    const explanation = {
      outcome: 'answered',
      say: 'We are open 8 to 5.',
      faq_id: 'hours',
      options: [],
      decided_by: 'similarity',
      reason: null,
      matches: [{ faq_id: 'hours', question: 'What are your hours?', category: null, similarity: 0.9 }],
      thresholds: { answerAt: 0.75, considerFrom: 0.5, margin: 0.05 },
    }

    it('answers from the FAQ list, recording the question, and returns only what the agent needs', async () => {
      faqs.answer.mockResolvedValue(explanation)

      const results = await controller.handleToolCalls(
        [{ id: 'call-1', function: { name: 'answer_question', arguments: { question: 'when are you open' } } }],
        ctx,
      )

      expect(faqs.answer).toHaveBeenCalledWith({ question: 'when are you open' }, { record: true }, ctx)
      expect(JSON.parse(results[0].result!)).toEqual({
        outcome: 'answered',
        say: 'We are open 8 to 5.',
        faq_id: 'hours',
        options: [],
      })
    })

    it('asks for the question when it is missing', async () => {
      const results = await controller.handleToolCalls(
        [{ id: 'call-1', function: { name: 'answer_question', arguments: { question: '  ' } } }],
        ctx,
      )

      expect(faqs.answer).not.toHaveBeenCalled()
      expect(results[0].error).toContain("Missing the caller's question")
    })

    it('tells the agent not to answer from its own knowledge when the lookup fails', async () => {
      faqs.answer.mockRejectedValue(new Error('OpenAI down'))

      const results = await controller.handleToolCalls(
        [{ id: 'call-1', function: { name: 'answer_question', arguments: { question: 'when are you open' } } }],
        ctx,
      )

      expect(results[0].error).toContain('Do not answer it from your own knowledge')
      expect(results[0].error).not.toContain('OpenAI')
    })
  })
})
