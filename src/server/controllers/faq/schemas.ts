import { z } from 'zod'

const question = z
  .string({ error: 'question is required' })
  .trim()
  .min(1, 'question is required')
  .max(500, 'question must be at most 500 characters')
const answer = z
  .string({ error: 'answer is required' })
  .trim()
  .min(1, 'answer is required')
  .max(2000, 'answer must be at most 2000 characters')
const category = z.string().trim().max(100, 'category must be at most 100 characters').nullable()

/** Arguments for the `answer_question` tool, and the body of POST /faqs/test. */
export const AnswerQuestionParamsSchema = z.object({ question })
export type AnswerQuestionParams = z.infer<typeof AnswerQuestionParamsSchema>

export const CreateFaqBodySchema = z.object({
  question,
  answer,
  category: category.optional(),
  active: z.boolean().optional(),
})
export type CreateFaqParams = z.infer<typeof CreateFaqBodySchema>

export const UpdateFaqBodySchema = CreateFaqBodySchema.partial().refine((body) => Object.keys(body).length > 0, {
  message: 'Send at least one of question, answer, category, active',
})
export type UpdateFaqParams = z.infer<typeof UpdateFaqBodySchema>

export const ImportFaqsBodySchema = z.object({
  faqs: z.array(CreateFaqBodySchema).min(1, 'faqs must not be empty').max(1000, 'at most 1000 faqs per import'),
  /** append (default) skips questions already in the list; replace deletes the whole list first. */
  mode: z.enum(['append', 'replace']).default('append'),
})
export type ImportFaqsParams = z.infer<typeof ImportFaqsBodySchema>

export const ListFaqsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false']).optional(),
})
export type ListFaqsQuery = z.infer<typeof ListFaqsQuerySchema>

export const IdParamsSchema = z.object({ id: z.uuid('id must be a UUID') })

export const ListCallerQuestionsQuerySchema = z.object({
  outcome: z.enum(['answered', 'clarify', 'unanswered']).optional(),
  status: z.enum(['open', 'resolved', 'dismissed']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})
export type ListCallerQuestionsQuery = z.infer<typeof ListCallerQuestionsQuerySchema>

/** Turn an unanswered caller question into a new FAQ. `question` defaults to the caller's wording. */
export const ResolveCallerQuestionBodySchema = z.object({
  answer,
  question: question.optional(),
  category: category.optional(),
})
export type ResolveCallerQuestionParams = z.infer<typeof ResolveCallerQuestionBodySchema>

export const UpdateCallerQuestionBodySchema = z.object({ status: z.enum(['open', 'dismissed']) })

export const AnswerOutcomeSchema = z.enum(['answered', 'clarify', 'unanswered'])

/** What the voice agent gets back from `answer_question`. */
export const AnswerResultSchema = z.object({
  outcome: AnswerOutcomeSchema,
  /** Ready to read out verbatim. */
  say: z.string(),
  faq_id: z.string().nullable(),
  /** Clarify only: once the caller picks one, read that option's answer verbatim. */
  options: z.array(z.object({ faq_id: z.string(), question: z.string(), answer: z.string() })),
})
export type AnswerResult = z.infer<typeof AnswerResultSchema>

/** POST /faqs/test: the same answer, plus how it was reached, for the clinic's "try a question" box. */
export const AnswerExplanationSchema = AnswerResultSchema.extend({
  decided_by: z.enum(['similarity', 'llm', 'fallback']),
  /** The LLM's one-sentence reason, when it decided. */
  reason: z.string().nullable(),
  matches: z.array(
    z.object({ faq_id: z.string(), question: z.string(), category: z.string().nullable(), similarity: z.number() }),
  ),
  thresholds: z.object({ answerAt: z.number(), considerFrom: z.number(), margin: z.number() }),
})
export type AnswerExplanation = z.infer<typeof AnswerExplanationSchema>

export const FaqResultSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  category: z.string().nullable(),
  active: z.boolean(),
  /** False until the server has embedded the current question; the agent can't match it until then. */
  searchable: z.boolean(),
  times_used: z.number(),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type FaqResult = z.infer<typeof FaqResultSchema>

export const CallerQuestionResultSchema = z.object({
  id: z.string(),
  question: z.string(),
  outcome: AnswerOutcomeSchema,
  decided_by: AnswerExplanationSchema.shape.decided_by,
  faq_id: z.string().nullable(),
  /** The FAQ that was read out, or the closest one. */
  faq_question: z.string().nullable(),
  top_similarity: z.number().nullable(),
  reason: z.string().nullable(),
  status: z.enum(['open', 'resolved', 'dismissed']).nullable(),
  resolved_faq_id: z.string().nullable(),
  call_id: z.string().nullable(),
  created_at: z.string(),
})
export type CallerQuestionResult = z.infer<typeof CallerQuestionResultSchema>
