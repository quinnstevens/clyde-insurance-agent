import { Router } from 'express'
import { faqController } from '@clyde-api/server/controllers/faq/FaqController'
import {
  IdParamsSchema,
  ListCallerQuestionsQuerySchema,
  ResolveCallerQuestionBodySchema,
  UpdateCallerQuestionBodySchema,
} from '@clyde-api/server/controllers/faq/schemas'
import { requireAdminKey } from '@clyde-api/server/middleware/requireAdminKey'
import { asyncHandler } from '@clyde-api/utils/asyncHandler'
import { parse } from '@clyde-api/utils/validate'

const router = Router()

router.use(requireAdminKey)

/**
 * GET /caller-questions?outcome=unanswered&status=open&limit=100
 * What callers asked the agent, newest first. outcome=unanswered&status=open is the clinic's inbox.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const query = parse(ListCallerQuestionsQuerySchema, req.query, ctx.requestId)
    res.json({ caller_questions: await faqController.listCallerQuestions(query, ctx) })
  }),
)

/**
 * POST /caller-questions/:id/resolve
 * Body: { answer, question?, category? }. Adds the FAQ (question defaults to the caller's words).
 */
router.post(
  '/:id/resolve',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const { id } = parse(IdParamsSchema, req.params, ctx.requestId)
    const body = parse(ResolveCallerQuestionBodySchema, req.body, ctx.requestId)
    res.status(201).json(await faqController.resolveCallerQuestion(id, body, ctx))
  }),
)

/**
 * PATCH /caller-questions/:id
 * Body: { status: 'dismissed' | 'open' }. Dismiss questions that don't need an FAQ.
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const { id } = parse(IdParamsSchema, req.params, ctx.requestId)
    const { status } = parse(UpdateCallerQuestionBodySchema, req.body, ctx.requestId)
    await faqController.setCallerQuestionStatus(id, status, ctx)
    res.status(204).end()
  }),
)

export default router
