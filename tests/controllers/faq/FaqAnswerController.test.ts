import { FaqAnswerController } from '@clyde-api/server/controllers/faq/FaqAnswerController'
import type { FaqMatch } from '@clyde-api/server/controllers/faq/decide'
import { AppError } from '@clyde-api/types/errors'

const thresholds = { answerAt: 0.75, considerFrom: 0.5, margin: 0.05 }

const faq = (id: string, question: string, answer: string, similarity: number): FaqMatch => ({
  id,
  question,
  answer,
  category: null,
  similarity,
})

const hours = faq('hours', 'What are your hours?', 'We are open 8 to 5.', 0.9)
const examPrice = faq('exam', 'How much is an eye exam without insurance?', 'An eye exam is 150 dollars.', 0.7)
const contactPrice = faq('contacts', 'How much is a contact lens exam?', 'A contact lens fitting is 75 dollars.', 0.68)

describe('FaqAnswerController', () => {
  const ctx = { requestId: 'test-request', callId: 'call-1' }
  const client = { embed: jest.fn(), chatJson: jest.fn() }
  const store = { search: jest.fn(), markUsed: jest.fn(), recordQuestion: jest.fn() }
  const controller = new FaqAnswerController(client, store, thresholds)

  const ask = (question: string, record = true) => controller.answer({ question }, { record }, ctx)

  beforeEach(() => {
    jest.resetAllMocks()
    client.embed.mockResolvedValue([[0.1, 0.2]])
  })

  it('reads a clear match word for word without calling the LLM', async () => {
    store.search.mockResolvedValue([hours, faq('sat', 'Are you open on Saturdays?', 'Yes, 9 to 1.', 0.7)])

    const result = await ask('when are you open')

    expect(client.chatJson).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      outcome: 'answered',
      say: 'We are open 8 to 5.',
      faq_id: 'hours',
      decided_by: 'similarity',
    })
    expect(store.markUsed).toHaveBeenCalledWith('hours')
    expect(store.recordQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'when are you open', outcome: 'answered', faqId: 'hours', callId: 'call-1' }),
    )
  })

  it("says it doesn't know, and records the question for the inbox, when nothing is close", async () => {
    store.search.mockResolvedValue([faq('parking', 'Is there parking?', 'Yes.', 0.31)])

    const result = await ask('do you sell hearing aids')

    expect(client.chatJson).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: 'unanswered', decided_by: 'similarity', faq_id: 'parking' })
    expect(result.say).toContain("I don't have an answer to that one")
    expect(store.recordQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'unanswered', topSimilarity: 0.31 }),
    )
    expect(store.markUsed).not.toHaveBeenCalled()
  })

  describe('the uncertain middle band', () => {
    beforeEach(() => {
      store.search.mockResolvedValue([examPrice, contactPrice])
    })

    it('lets the LLM pick one of the committed answers', async () => {
      client.chatJson.mockResolvedValue({ decision: 'match', faq_ids: ['2'], reason: 'They asked about contacts.' })

      const result = await ask('what do you charge to get fitted for contacts')

      const [messages] = client.chatJson.mock.calls[0]
      expect(JSON.parse(messages[1].content)).toEqual({
        patient_question: 'what do you charge to get fitted for contacts',
        candidates: [
          { id: '1', question: examPrice.question, answer: examPrice.answer },
          { id: '2', question: contactPrice.question, answer: contactPrice.answer },
        ],
      })
      expect(result).toMatchObject({
        outcome: 'answered',
        say: contactPrice.answer,
        faq_id: 'contacts',
        decided_by: 'llm',
        reason: 'They asked about contacts.',
      })
    })

    it('asks the caller which one they meant, and hands the agent both answers', async () => {
      client.chatJson.mockResolvedValue({ decision: 'clarify', faq_ids: ['1', '2'], reason: 'Could be either exam.' })

      const result = await ask('how much is an exam')

      expect(result.outcome).toBe('clarify')
      expect(result.say).toBe(
        'Just so I give you the right answer, did you mean: How much is an eye exam without insurance? Or: How much is a contact lens exam?',
      )
      expect(result.options).toEqual([
        { faq_id: 'exam', question: examPrice.question, answer: examPrice.answer },
        { faq_id: 'contacts', question: contactPrice.question, answer: contactPrice.answer },
      ])
    })

    it("says it doesn't know when the LLM finds no candidate answers the question", async () => {
      client.chatJson.mockResolvedValue({ decision: 'none', faq_ids: [], reason: 'Asks about glasses, not exams.' })

      const result = await ask('how much is a pair of glasses')

      expect(result).toMatchObject({ outcome: 'unanswered', decided_by: 'llm' })
      expect(store.recordQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'unanswered', reason: 'Asks about glasses, not exams.' }),
      )
    })

    it('ignores an id the LLM made up instead of answering with it', async () => {
      client.chatJson.mockResolvedValue({ decision: 'match', faq_ids: ['7'], reason: 'Made up.' })

      const result = await ask('how much is an exam')

      expect(result.outcome).toBe('unanswered')
    })

    it('asks the caller instead of guessing when the LLM is unavailable', async () => {
      client.chatJson.mockRejectedValue(AppError.timeout('OpenAI request timed out'))

      const result = await ask('how much is an exam')

      expect(result).toMatchObject({ outcome: 'clarify', decided_by: 'fallback' })
      expect(result.options.map((o) => o.faq_id)).toEqual(['exam', 'contacts'])
    })
  })

  it('records nothing for the clinic test box', async () => {
    store.search.mockResolvedValue([hours])

    const result = await ask('when are you open', false)

    expect(store.recordQuestion).not.toHaveBeenCalled()
    expect(store.markUsed).not.toHaveBeenCalled()
    expect(result.matches).toEqual([{ faq_id: 'hours', question: hours.question, category: null, similarity: 0.9 }])
    expect(result.thresholds).toEqual(thresholds)
  })

  it('still answers the caller when recording the question fails', async () => {
    store.search.mockResolvedValue([hours])
    store.recordQuestion.mockRejectedValue(new Error('db down'))

    const result = await ask('when are you open')

    expect(result.outcome).toBe('answered')
  })

  it('lets embedding failures propagate so the tool reports them', async () => {
    client.embed.mockRejectedValue(AppError.externalApi('OpenAI returned 500'))

    await expect(ask('when are you open')).rejects.toThrow('OpenAI returned 500')
  })
})
