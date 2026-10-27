import { Base as Model } from '@clyde-api/utils/baseModel'

export type CallerQuestionOutcome = 'answered' | 'clarify' | 'unanswered'
export type CallerQuestionDecidedBy = 'similarity' | 'llm' | 'fallback'
export type CallerQuestionStatus = 'open' | 'resolved' | 'dismissed'

/** One question a caller asked the agent. Unanswered ones (status `open`) are the clinic's inbox. */
export default class CallerQuestion extends Model {
  id!: string
  question!: string
  outcome!: CallerQuestionOutcome
  decided_by!: CallerQuestionDecidedBy
  /** The FAQ that was read out (answered) or the closest one (clarify, unanswered). */
  faq_id!: string | null
  top_similarity!: number | null
  /** The LLM's one-line reason, when it decided. */
  reason!: string | null
  status!: CallerQuestionStatus | null
  resolved_faq_id!: string | null
  call_id!: string | null

  static get tableName() {
    return 'caller_questions'
  }
}
