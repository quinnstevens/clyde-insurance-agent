import { Router } from 'express'
import { eligibilityController } from '@clyde-api/server/controllers/eligibility/EligibilityController'
import { CheckInsuranceParamsSchema } from '@clyde-api/server/controllers/eligibility/schemas'
import { requireToolSecret } from '@clyde-api/server/middleware/requireToolSecret'
import { asyncHandler } from '@clyde-api/utils/asyncHandler'
import { parse } from '@clyde-api/utils/validate'

const router = Router()

router.use(requireToolSecret)

/**
 * POST /eligibility/check
 * Body: { caller_name, date_of_birth: 'YYYY-MM-DD' }. The same check the voice agent runs, without the Vapi envelope, so it can be
 * exercised with curl.
 */
router.post(
  '/check',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const body = parse(CheckInsuranceParamsSchema, req.body, ctx.requestId)

    const result = await eligibilityController.checkByCallerName(body, ctx)
    res.json({ result })
  }),
)

export default router
