import { decideBySimilarity, type FaqMatch } from '@clyde-api/server/controllers/faq/decide'

const thresholds = { answerAt: 0.75, considerFrom: 0.5, margin: 0.05 }

const match = (id: string, similarity: number, answer = `answer ${id}`): FaqMatch => ({
  id,
  question: `question ${id}?`,
  answer,
  category: null,
  similarity,
})

describe('decideBySimilarity', () => {
  it('answers a clear winner without review', () => {
    const decision = decideBySimilarity([match('a', 0.9), match('b', 0.6)], thresholds)

    expect(decision).toEqual({ kind: 'answer', match: match('a', 0.9) })
  })

  it('answers when it is the only match above answerAt', () => {
    expect(decideBySimilarity([match('a', 0.8)], thresholds).kind).toBe('answer')
  })

  it('sends two strong matches with different answers to review', () => {
    const decision = decideBySimilarity([match('a', 0.86), match('b', 0.84), match('c', 0.4)], thresholds)

    expect(decision).toEqual({ kind: 'review', candidates: [match('a', 0.86), match('b', 0.84)] })
  })

  it('answers two strong matches that say the same thing', () => {
    const decision = decideBySimilarity([match('a', 0.86, 'same'), match('b', 0.85, 'same')], thresholds)

    expect(decision.kind).toBe('answer')
  })

  it('sends the uncertain middle band to review, dropping candidates below considerFrom', () => {
    const decision = decideBySimilarity([match('a', 0.7), match('b', 0.55), match('c', 0.45)], thresholds)

    expect(decision).toEqual({ kind: 'review', candidates: [match('a', 0.7), match('b', 0.55)] })
  })

  it('gives up below considerFrom, keeping the closest match for the inbox', () => {
    expect(decideBySimilarity([match('a', 0.42)], thresholds)).toEqual({ kind: 'unanswered', top: match('a', 0.42) })
  })

  it('gives up when there are no FAQs at all', () => {
    expect(decideBySimilarity([], thresholds)).toEqual({ kind: 'unanswered', top: null })
  })

  it('reviews at most four candidates', () => {
    const matches = [0.7, 0.69, 0.68, 0.67, 0.66].map((s, i) => match(String(i), s))

    const decision = decideBySimilarity(matches, thresholds)

    expect(decision.kind === 'review' && decision.candidates).toHaveLength(4)
  })
})
