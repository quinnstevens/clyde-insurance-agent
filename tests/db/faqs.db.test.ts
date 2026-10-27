import { EMBEDDING_DIMENSIONS } from '@clyde-api/config/faq'
import CallerQuestion from '@clyde-api/models/callerQuestion'
import Faq from '@clyde-api/models/faq'
import { FaqAnswerController } from '@clyde-api/server/controllers/faq/FaqAnswerController'
import { FaqController } from '@clyde-api/server/controllers/faq/FaqController'
import { faqStore } from '@clyde-api/server/controllers/faq/faqStore'
import { closeDb, connectDb } from '@clyde-api/utils/database'

/**
 * A stand-in embedding model: each known text points along its own axes, so cosine similarities are
 * exact and readable. "hours" and "open late" share an axis, so they come out at 0.8.
 */
const axis = (i: number, weight = 1) => ({ i, weight })
const DIRECTIONS: Record<string, { i: number; weight: number }[]> = {
  'What are your hours?': [axis(0)],
  'Do you have evening hours?': [axis(0, 0.8), axis(1, 0.6)],
  'Is there parking?': [axis(2)],
  'when are you open': [axis(0)],
  'are you open late': [axis(0, 0.8), axis(1, 0.6)],
  'do you sell hearing aids': [axis(3)],
}
const embedText = (text: string) => {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0)
  for (const { i, weight } of DIRECTIONS[text] ?? [axis(4)]) vector[i] = weight
  return vector
}
const fakeClient = {
  configured: true,
  embed: jest.fn(async (texts: string[]) => texts.map(embedText)),
  chatJson: jest.fn(),
}

describe('FAQs against Postgres + pgvector', () => {
  const ctx = { requestId: 'db-test' }
  const faqs = new FaqController(fakeClient)

  beforeAll(async () => {
    const knex = await connectDb()
    await knex.migrate.latest()
  })

  afterAll(async () => {
    await closeDb()
  })

  beforeEach(async () => {
    await CallerQuestion.query().delete()
    await Faq.query().delete()
    jest.clearAllMocks()
  })

  const seed = async () => {
    await faqs.import(
      {
        mode: 'append',
        faqs: [
          { question: 'What are your hours?', answer: 'We are open 8 to 5.', category: 'Hours' },
          { question: 'Do you have evening hours?', answer: 'Thursdays until 7.', category: 'Hours' },
          { question: 'Is there parking?', answer: 'Yes, free parking.', category: 'Location' },
        ],
      },
      ctx,
    )
  }

  it('the seed migration loaded 250 FAQs on a fresh database', async () => {
    // Checked through the migration file itself, since beforeEach clears the table.
    const seeded = require('../../migrations/data/clinic-faqs.json')
    expect(seeded).toHaveLength(250)
  })

  it('finds the nearest FAQs by cosine similarity, best first', async () => {
    await seed()

    const matches = await faqStore.search(embedText('when are you open'))

    expect(matches.map((m) => [m.question, Number(m.similarity.toFixed(3))])).toEqual([
      ['What are your hours?', 1],
      ['Do you have evening hours?', 0.8],
      ['Is there parking?', 0],
    ])
  })

  it('leaves out inactive FAQs and ones edited since they were embedded', async () => {
    await seed()
    const [hours, evening] = await faqs.list({}, ctx).then((all) => all.filter((f) => f.category === 'Hours'))
    await faqs.update(evening.id, { active: false }, ctx)
    // An edit that hasn't been re-embedded yet, e.g. saved while OpenAI was down.
    await Faq.query().findById(hours.id).patch({ question: 'What time do you open?' })

    const matches = await faqStore.search(embedText('when are you open'))

    expect(matches.map((m) => m.question)).toEqual(['Is there parking?'])
    expect((await faqs.get(hours.id, ctx)).searchable).toBe(false)
  })

  it('re-embeds an edited question and skips duplicate imports', async () => {
    await seed()
    const result = await faqs.import(
      {
        mode: 'append',
        faqs: [
          { question: 'what are your hours?', answer: 'dup' },
          { question: 'New?', answer: 'Yes' },
        ],
      },
      ctx,
    )
    expect(result).toEqual({ created: 1, skipped: 1 })

    const parking = (await faqs.list({ search: 'parking' }, ctx))[0]
    const updated = await faqs.update(parking.id, { question: 'Is parking free?' }, ctx)

    expect(updated.searchable).toBe(true)
    expect(fakeClient.embed).toHaveBeenLastCalledWith(['Is parking free?'], ctx)
  })

  it('embedPending fills in rows that have no vector yet', async () => {
    await Faq.query().insert({ question: 'Is there parking?', answer: 'Yes.' })

    expect(await faqs.embedPending(ctx)).toEqual({ embedded: 1, remaining: 0 })
    expect(await faqs.embedPending(ctx)).toEqual({ embedded: 0, remaining: 0 })
  })

  it('answers, counts use, and sends unknown questions to the inbox', async () => {
    await seed()
    const answerer = new FaqAnswerController(fakeClient, faqStore, { answerAt: 0.9, considerFrom: 0.5, margin: 0.05 })

    const answered = await answerer.answer({ question: 'when are you open' }, { record: true }, ctx)
    const unknown = await answerer.answer({ question: 'do you sell hearing aids' }, { record: true }, ctx)

    expect(answered).toMatchObject({ outcome: 'answered', say: 'We are open 8 to 5.' })
    expect(unknown.outcome).toBe('unanswered')
    const hours = (await faqs.list({ search: 'What are your hours' }, ctx))[0]
    expect(hours.times_used).toBe(1)

    const inbox = await faqs.listCallerQuestions({ outcome: 'unanswered', status: 'open', limit: 10 }, ctx)
    expect(inbox.map((q) => q.question)).toEqual(['do you sell hearing aids'])

    const { faq } = await faqs.resolveCallerQuestion(inbox[0].id, { answer: 'No, we do not.' }, ctx)
    expect(faq).toMatchObject({ question: 'do you sell hearing aids', searchable: true })
    expect(await faqs.listCallerQuestions({ outcome: 'unanswered', status: 'open', limit: 10 }, ctx)).toEqual([])
  })
})
