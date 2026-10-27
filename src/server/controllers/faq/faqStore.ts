import { FAQ_SEARCH_LIMIT } from '@clyde-api/config/faq'
import CallerQuestion, {
  type CallerQuestionDecidedBy,
  type CallerQuestionOutcome,
} from '@clyde-api/models/callerQuestion'
import Faq from '@clyde-api/models/faq'
import { cosineDistance, cosineSimilarity } from '@clyde-api/utils/pgvector'
import type { FaqMatch } from './decide'

export interface RecordQuestionParams {
  question: string
  outcome: CallerQuestionOutcome
  decidedBy: CallerQuestionDecidedBy
  faqId: string | null
  topSimilarity: number | null
  reason: string | null
  callId: string | null
}

/** The database side of answering a question, kept apart so the decision logic tests without Postgres. */
export const faqStore = {
  /**
   * Nearest active FAQs by cosine similarity (1 = same meaning). Rows edited since they were embedded are skipped: their
   * vector describes the old question.
   */
  async search(vector: number[], limit = FAQ_SEARCH_LIMIT): Promise<FaqMatch[]> {
    const rows = await Faq.query()
      .select('id', 'question', 'answer', 'category', cosineSimilarity('embedding', vector, 'similarity'))
      .where('active', true)
      .whereNotNull('embedding')
      .whereColumn('embedded_question', 'question')
      .orderBy(cosineDistance('embedding', vector) as unknown as string)
      .limit(limit)
    return rows.map((row) => {
      const { id, question, answer, category, similarity } = row as Faq & { similarity: number | string }
      return { id, question, answer, category, similarity: Number(similarity) }
    })
  },

  /**
   * Plain Knex rather than an Objection patch: a patch would drop the increment, and would bump
   * `updated_at`, which should only move when the clinic edits the FAQ.
   */
  async markUsed(faqId: string): Promise<void> {
    await Faq.knexQuery().where('id', faqId).update({ last_used_at: new Date() }).increment('times_used', 1)
  },

  async recordQuestion(params: RecordQuestionParams): Promise<void> {
    await CallerQuestion.query().insert({
      question: params.question,
      outcome: params.outcome,
      decided_by: params.decidedBy,
      faq_id: params.faqId,
      top_similarity: params.topSimilarity,
      reason: params.reason,
      status: params.outcome === 'unanswered' ? 'open' : null,
      call_id: params.callId,
    })
  },
}

export type FaqStore = typeof faqStore
