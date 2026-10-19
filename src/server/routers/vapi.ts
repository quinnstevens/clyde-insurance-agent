import { Router } from 'express'
import { VapiServerMessageBodySchema } from '@clyde-api/server/controllers/vapi/schemas'
import { vapiToolController } from '@clyde-api/server/controllers/vapi/VapiToolController'
import { requireToolSecret } from '@clyde-api/server/middleware/requireToolSecret'
import { asyncHandler } from '@clyde-api/utils/asyncHandler'
import { parse } from '@clyde-api/utils/validate'

const router = Router()

router.use(requireToolSecret)

/**
 * POST /vapi/tools
 * The server URL configured on the Vapi tool. Body: { message: { type: 'tool-calls', toolCallList } }.
 * Always answers 200 with { results: [{ toolCallId, result | error }] }; Vapi ignores any other status.
 */
router.post(
  '/tools',
  asyncHandler(async (req, res) => {
    const ctx = { requestId: req.context?.requestId }
    const { message } = parse(VapiServerMessageBodySchema, req.body, ctx.requestId)

    if (message.type !== 'tool-calls') {
      res.json({})
      return
    }

    const results = await vapiToolController.handleToolCalls(message.toolCallList ?? [], ctx)
    res.json({ results })
  }),
)

export default router
