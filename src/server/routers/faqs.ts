import { Router } from 'express'
import { faqAnswerController } from '@clyde-api/server/controllers/faq/FaqAnswerController'
import { faqController } from '@clyde-api/server/controllers/faq/FaqController'
import {
  AnswerQuestionParamsSchema,
  CreateFaqBodySchema,
  IdParamsSchema,
  ImportFaqsBodySchema,
  ListFaqsQuerySchema,
  UpdateFaqBodySchema,
} from '@clyde-api/server/controllers/faq/schemas'
import { requireAdminKey } from '@clyde-api/server/middleware/requireAdminKey'
import { asyncHandler } from '@clyde-api/utils/asyncHandler'
import { parse } from '@clyde-api/utils/validate'

const router = Router()

router.use(requireAdminKey)

/**
 * GET /faqs?search=&category=&active=true|false
 * The whole list, by category then question. `searchable: false` means not embedded yet.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const query = parse(ListFaqsQuerySchema, req.query, ctx.requestId)
    res.json({ faqs: await faqController.list(query, ctx) })
  }),
)

/**
 * POST /faqs/test
 * Body: { question }. Runs exactly what the phone agent runs and explains it (matches, scores,
 * thresholds, who decided). Nothing is recorded.
 */
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const body = parse(AnswerQuestionParamsSchema, req.body, ctx.requestId)
    res.json({ result: await faqAnswerController.answer(body, { record: false }, ctx) })
  }),
)

/**
 * POST /faqs/import
 * Body: { faqs: [{ question, answer, category? }], mode?: 'append' | 'replace' }.
 */
router.post(
  '/import',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const body = parse(ImportFaqsBodySchema, req.body, ctx.requestId)
    res.status(201).json(await faqController.import(body, ctx))
  }),
)

/**
 * POST /faqs/reindex
 * Embeds any FAQ that isn't searchable yet (e.g. saved while OpenAI was down).
 */
router.post(
  '/reindex',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    res.json(await faqController.embedPending(ctx))
  }),
)

/**
 * POST /faqs
 * Body: { question, answer, category?, active? }
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const body = parse(CreateFaqBodySchema, req.body, ctx.requestId)
    res.status(201).json({ faq: await faqController.create(body, ctx) })
  }),
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const { id } = parse(IdParamsSchema, req.params, ctx.requestId)
    res.json({ faq: await faqController.get(id, ctx) })
  }),
)

/**
 * PATCH /faqs/:id
 * Body: any of { question, answer, category, active }. A changed question is re-embedded.
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const { id } = parse(IdParamsSchema, req.params, ctx.requestId)
    const body = parse(UpdateFaqBodySchema, req.body, ctx.requestId)
    res.json({ faq: await faqController.update(id, body, ctx) })
  }),
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const { id } = parse(IdParamsSchema, req.params, ctx.requestId)
    await faqController.remove(id, ctx)
    res.status(204).end()
  }),
)

export default router
