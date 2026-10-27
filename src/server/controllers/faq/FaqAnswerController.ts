import { FAQ_THRESHOLDS, type FaqThresholds } from '@clyde-api/config/faq'
import type { RequestContext } from '@clyde-api/types/context'
import { AppError } from '@clyde-api/types/errors'
import logger from '@clyde-api/utils/logger'
import { openai, type OpenAIClient } from '@clyde-api/utils/openai'
import { decideBySimilarity, type FaqMatch } from './decide'
import { faqStore, type FaqStore } from './faqStore'
import { faqMessages } from './messages'
import { reviewCandidates } from './reviewCandidates'
import type { AnswerExplanation, AnswerQuestionParams } from './schemas'

export interface AnswerOptions {
  /** Record the question and count FAQ use. Off for the clinic's test box, so tests don't fill the inbox. */
  record: boolean
}

const answered = (match: FaqMatch) => ({
  outcome: 'answered' as const,
  say: match.answer,
  faq_id: match.id,
  options: [],
})

const clarify = (options: FaqMatch[]) => ({
  outcome: 'clarify' as const,
  say: faqMessages.clarify(options.map((o) => o.question)),
  faq_id: options[0].id,
  options: options.map((o) => ({ faq_id: o.id, question: o.question, answer: o.answer })),
})

const unanswered = (top: FaqMatch | null) => ({
  outcome: 'unanswered' as const,
  say: faqMessages.unanswered(),
  faq_id: top?.id ?? null,
  options: [],
})

/**
 * Answers a caller's question from the clinic's FAQ list, in three steps:
 *
 * 1. Embed the question and find the nearest FAQs (pgvector, cosine similarity).
 * 2. A clear winner is read out as-is, and nothing close means "I don't know". No LLM call either way.
 * 3. In between, an LLM looks at the close FAQs and picks one, asks the caller which they meant,
 *    or says none fits.
 *
 * Whatever is said comes from a committed answer or a fixed sentence: the LLM chooses, it never
 * writes. Unanswered questions are recorded so the clinic can add the missing FAQ.
 */
export class FaqAnswerController {
  constructor(
    private readonly client: Pick<OpenAIClient, 'embed' | 'chatJson'> = openai,
    private readonly store: Pick<FaqStore, 'search' | 'markUsed' | 'recordQuestion'> = faqStore,
    private readonly thresholds: FaqThresholds = FAQ_THRESHOLDS,
  ) {}

  async answer(params: AnswerQuestionParams, options: AnswerOptions, ctx: RequestContext): Promise<AnswerExplanation> {
    const [vector] = await this.client.embed([params.question], ctx)
    const matches = await this.store.search(vector)
    const top = matches[0] ?? null
    const first = decideBySimilarity(matches, this.thresholds)

    let result: Omit<AnswerExplanation, 'matches' | 'thresholds'>
    if (first.kind === 'answer') {
      result = { ...answered(first.match), decided_by: 'similarity', reason: null }
    } else if (first.kind === 'unanswered') {
      result = { ...unanswered(top), decided_by: 'similarity', reason: null }
    } else {
      result = await this.review(params.question, first.candidates, ctx)
    }

    logger.info('[FaqAnswerController] question answered', {
      requestId: ctx.requestId,
      outcome: result.outcome,
      decidedBy: result.decided_by,
      faqId: result.faq_id,
      topSimilarity: top?.similarity ?? null,
    })

    if (options.record) {
      await this.record(params.question, result, top, ctx)
    }

    return {
      ...result,
      matches: matches.map((m) => ({
        faq_id: m.id,
        question: m.question,
        category: m.category,
        similarity: m.similarity,
      })),
      thresholds: { ...this.thresholds },
    }
  }

  private async review(
    question: string,
    candidates: FaqMatch[],
    ctx: RequestContext,
  ): Promise<Omit<AnswerExplanation, 'matches' | 'thresholds'>> {
    try {
      const decision = await reviewCandidates(question, candidates, this.client, ctx)
      if (decision.kind === 'match') return { ...answered(decision.match), decided_by: 'llm', reason: decision.reason }
      if (decision.kind === 'clarify')
        return { ...clarify(decision.options), decided_by: 'llm', reason: decision.reason }
      return { ...unanswered(candidates[0]), decided_by: 'llm', reason: decision.reason }
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      // Without the LLM, don't guess between close answers: confirm the best one with the caller.
      logger.warn('[FaqAnswerController] review failed, asking the caller instead', {
        requestId: ctx.requestId,
        errorCode: error.code,
      })
      return { ...clarify(candidates.slice(0, 2)), decided_by: 'fallback', reason: null }
    }
  }

  private async record(
    question: string,
    result: Omit<AnswerExplanation, 'matches' | 'thresholds'>,
    top: FaqMatch | null,
    ctx: RequestContext,
  ): Promise<void> {
    // The caller has their answer either way; a failed write must not turn it into an error.
    try {
      await this.store.recordQuestion({
        question,
        outcome: result.outcome,
        decidedBy: result.decided_by,
        faqId: result.faq_id,
        topSimilarity: top?.similarity ?? null,
        reason: result.reason,
        callId: ctx.callId ?? null,
      })
      if (result.outcome === 'answered' && result.faq_id) await this.store.markUsed(result.faq_id)
    } catch (error) {
      logger.error(error as Error, '[FaqAnswerController] failed to record question', { requestId: ctx.requestId })
    }
  }
}

export const faqAnswerController = new FaqAnswerController()
