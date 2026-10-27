import { FAQ_MAX_CANDIDATES, type FaqThresholds } from '@clyde-api/config/faq'

export interface FaqMatch {
  id: string
  question: string
  answer: string
  category: string | null
  /** Cosine similarity to the caller's question, 0 to 1. */
  similarity: number
}

export type SimilarityDecision =
  | { kind: 'answer'; match: FaqMatch }
  | { kind: 'review'; candidates: FaqMatch[] }
  | { kind: 'unanswered'; top: FaqMatch | null }

/**
 * The cheap first pass, from similarity scores alone. `matches` is ordered best first.
 *
 * Only a clear winner is answered here. Two strong matches that say different things ("how much is
 * an eye exam" vs "how much is a contact lens exam") are not a clear winner, so they go to review
 * even when both clear `answerAt`.
 */
export const decideBySimilarity = (matches: FaqMatch[], thresholds: FaqThresholds): SimilarityDecision => {
  const [top, second] = matches
  if (!top || top.similarity < thresholds.considerFrom) return { kind: 'unanswered', top: top ?? null }

  const clearWinner = !second || top.similarity - second.similarity >= thresholds.margin || second.answer === top.answer
  if (top.similarity >= thresholds.answerAt && clearWinner) return { kind: 'answer', match: top }

  return {
    kind: 'review',
    candidates: matches.filter((m) => m.similarity >= thresholds.considerFrom).slice(0, FAQ_MAX_CANDIDATES),
  }
}
