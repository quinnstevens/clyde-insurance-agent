import { Base as Model } from '@clyde-api/utils/baseModel'

export default class Faq extends Model {
  id!: string
  question!: string
  answer!: string
  category!: string | null
  /** Inactive FAQs stay in the list for the clinic but are never used to answer callers. */
  active!: boolean
  /** pgvector column. Never selected; written with `toSql` from `@clyde-api/utils/pgvector`. */
  embedding?: unknown
  /**
   * The `question` text `embedding` was made from, set in the same write. Null until embedded, and
   * different from `question` after an edit until re-embedded: either way the FAQ isn't searchable.
   */
  embedded_question!: string | null
  times_used!: number
  last_used_at!: Date | null

  static get tableName() {
    return 'faqs'
  }
}
