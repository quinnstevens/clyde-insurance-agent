import CallerQuestion from '@clyde-api/models/callerQuestion'
import Faq from '@clyde-api/models/faq'
import type { RequestContext } from '@clyde-api/types/context'
import { AppError } from '@clyde-api/types/errors'
import { getKnex } from '@clyde-api/utils/database'
import logger from '@clyde-api/utils/logger'
import { openai, type OpenAIClient } from '@clyde-api/utils/openai'
import { toSql } from '@clyde-api/utils/pgvector'
import type {
  CallerQuestionResult,
  CreateFaqParams,
  FaqResult,
  ImportFaqsParams,
  ListCallerQuestionsQuery,
  ListFaqsQuery,
  ResolveCallerQuestionParams,
  UpdateFaqParams,
} from './schemas'

// Never select `embedding`: 1536 numbers per row that no client needs.
const FAQ_COLUMNS = [
  'id',
  'question',
  'answer',
  'category',
  'active',
  'times_used',
  'last_used_at',
  'created_at',
  'updated_at',
  'embedded_question',
] as const

const EMBED_BATCH_SIZE = 100

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())

const toFaqResult = (faq: Faq): FaqResult => ({
  id: faq.id,
  question: faq.question,
  answer: faq.answer,
  category: faq.category,
  active: faq.active,
  searchable: faq.embedded_question === faq.question,
  times_used: faq.times_used,
  last_used_at: iso(faq.last_used_at),
  created_at: iso(faq.created_at)!,
  updated_at: iso(faq.updated_at)!,
})

const toCallerQuestionResult = (row: CallerQuestion & { faq_question?: string | null }): CallerQuestionResult => ({
  id: row.id,
  question: row.question,
  outcome: row.outcome,
  decided_by: row.decided_by,
  faq_id: row.faq_id,
  faq_question: row.faq_question ?? null,
  top_similarity: row.top_similarity,
  reason: row.reason,
  status: row.status,
  resolved_faq_id: row.resolved_faq_id,
  call_id: row.call_id,
  created_at: iso(row.created_at)!,
})

const sameQuestion = (text: string) => text.trim().toLowerCase()

/**
 * The clinic's side of the FAQ list: what the management app calls. Every write that changes a
 * question re-embeds it. If OpenAI is down the write still succeeds and the row comes back `searchable: false`;
 * `embedPending` picks it up later (it also runs on startup).
 */
export class FaqController {
  constructor(private readonly client: Pick<OpenAIClient, 'embed' | 'configured'> = openai) {}

  async list(query: ListFaqsQuery, _ctx: RequestContext): Promise<FaqResult[]> {
    const builder = Faq.query()
      .select(...FAQ_COLUMNS)
      .orderBy([{ column: 'category' }, { column: 'question' }])
    if (query.active) builder.where('active', query.active === 'true')
    if (query.category) builder.where('category', query.category)
    if (query.search) {
      const term = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      builder.where((q) => q.where('question', 'ilike', term).orWhere('answer', 'ilike', term))
    }
    return (await builder).map(toFaqResult)
  }

  async get(id: string, ctx: RequestContext): Promise<FaqResult> {
    const faq = await Faq.query()
      .select(...FAQ_COLUMNS)
      .findById(id)
    if (!faq) throw AppError.notFound('FAQ not found', { requestId: ctx.requestId, faqId: id })
    return toFaqResult(faq)
  }

  async create(params: CreateFaqParams, ctx: RequestContext): Promise<FaqResult> {
    const faq = await Faq.query().insert({ ...params, category: params.category ?? null })
    await this.embedRows([faq], ctx)
    logger.info('[FaqController] created faq', { requestId: ctx.requestId, faqId: faq.id })
    return this.get(faq.id, ctx)
  }

  async update(id: string, params: UpdateFaqParams, ctx: RequestContext): Promise<FaqResult> {
    const faq = await Faq.query().patchAndFetchById(id, params)
    if (!faq) throw AppError.notFound('FAQ not found', { requestId: ctx.requestId, faqId: id })
    if (faq.embedded_question !== faq.question) await this.embedRows([faq], ctx)
    logger.info('[FaqController] updated faq', { requestId: ctx.requestId, faqId: id })
    return this.get(id, ctx)
  }

  async remove(id: string, ctx: RequestContext): Promise<void> {
    const deleted = await Faq.query().deleteById(id)
    if (!deleted) throw AppError.notFound('FAQ not found', { requestId: ctx.requestId, faqId: id })
    logger.info('[FaqController] deleted faq', { requestId: ctx.requestId, faqId: id })
  }

  /** Bulk load, e.g. a clinic's spreadsheet. Returns how many were added and skipped as duplicates. */
  async import(params: ImportFaqsParams, ctx: RequestContext): Promise<{ created: number; skipped: number }> {
    const inserted = await getKnex().transaction(async (trx) => {
      if (params.mode === 'replace') await Faq.query(trx).delete()

      const existing = new Set((await Faq.query(trx).select('question')).map((f) => sameQuestion(f.question)))
      const fresh = params.faqs.filter((faq) => {
        const key = sameQuestion(faq.question)
        if (existing.has(key)) return false
        existing.add(key)
        return true
      })
      if (fresh.length === 0) return []
      return Faq.query(trx).insert(fresh.map((faq) => ({ ...faq, category: faq.category ?? null })))
    })

    await this.embedRows(inserted, ctx)
    logger.info('[FaqController] imported faqs', {
      requestId: ctx.requestId,
      mode: params.mode,
      created: inserted.length,
      skipped: params.faqs.length - inserted.length,
    })
    return { created: inserted.length, skipped: params.faqs.length - inserted.length }
  }

  /** Embed every FAQ that has no vector yet or was edited since. Safe to run any time. */
  async embedPending(ctx: RequestContext): Promise<{ embedded: number; remaining: number }> {
    const pending = await Faq.query()
      .select('id', 'question')
      .where((q) => q.whereNull('embedded_question').orWhereColumn('embedded_question', '<>', 'question'))
    const embedded = await this.embedRows(pending, ctx)
    return { embedded, remaining: pending.length - embedded }
  }

  async listCallerQuestions(query: ListCallerQuestionsQuery, _ctx: RequestContext): Promise<CallerQuestionResult[]> {
    const builder = CallerQuestion.query()
      .select('caller_questions.*', 'faqs.question AS faq_question')
      .leftJoin('faqs', 'faqs.id', 'caller_questions.faq_id')
      .orderBy('caller_questions.created_at', 'desc')
      .limit(query.limit)
    if (query.outcome) builder.where('caller_questions.outcome', query.outcome)
    if (query.status) builder.where('caller_questions.status', query.status)
    return (await builder).map(toCallerQuestionResult)
  }

  /** Answer an inbox question by adding it to the FAQ list. */
  async resolveCallerQuestion(
    id: string,
    params: ResolveCallerQuestionParams,
    ctx: RequestContext,
  ): Promise<{ faq: FaqResult; caller_question_id: string }> {
    const callerQuestion = await CallerQuestion.query().findById(id)
    if (!callerQuestion) throw AppError.notFound('Caller question not found', { requestId: ctx.requestId })

    const faq = await this.create(
      { question: params.question ?? callerQuestion.question, answer: params.answer, category: params.category },
      ctx,
    )
    await CallerQuestion.query().findById(id).patch({ status: 'resolved', resolved_faq_id: faq.id })
    return { faq, caller_question_id: id }
  }

  async setCallerQuestionStatus(id: string, status: 'open' | 'dismissed', ctx: RequestContext): Promise<void> {
    const updated = await CallerQuestion.query().findById(id).patch({ status })
    if (!updated) throw AppError.notFound('Caller question not found', { requestId: ctx.requestId })
  }

  /** Returns how many rows got a vector. Never throws for OpenAI trouble: the rows just stay pending. */
  private async embedRows(rows: Pick<Faq, 'id' | 'question'>[], ctx: RequestContext): Promise<number> {
    if (rows.length === 0) return 0
    if (!this.client.configured) {
      logger.warn('[FaqController] OPENAI_API_KEY is not set; FAQs left unembedded', {
        requestId: ctx.requestId,
        count: rows.length,
      })
      return 0
    }

    let embedded = 0
    for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
      const batch = rows.slice(i, i + EMBED_BATCH_SIZE)
      try {
        const vectors = await this.client.embed(
          batch.map((row) => row.question),
          ctx,
        )
        await getKnex().transaction(async (trx) => {
          for (const [j, row] of batch.entries()) {
            // Plain Knex, like markUsed: indexing isn't an edit, so updated_at stays put.
            await Faq.knexQuery()
              .transacting(trx)
              .where('id', row.id)
              .update({ embedding: toSql(vectors[j]), embedded_question: row.question })
          }
        })
        embedded += batch.length
      } catch (error) {
        if (!(error instanceof AppError)) throw error
        logger.warn('[FaqController] embedding failed; FAQs left pending', {
          requestId: ctx.requestId,
          errorCode: error.code,
          count: batch.length,
        })
      }
    }
    return embedded
  }
}

export const faqController = new FaqController()
