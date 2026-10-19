import {
  eligibilityController,
  type EligibilityController,
} from '@clyde-api/server/controllers/eligibility/EligibilityController'
import { CheckInsuranceParamsSchema } from '@clyde-api/server/controllers/eligibility/schemas'
import type { RequestContext } from '@clyde-api/types/context'
import logger from '@clyde-api/utils/logger'
import type { VapiToolCall, VapiToolResult } from './schemas'

// Read by the model, not the caller: tell it what to do next, never expose internals.
const TOOL_FAILURE_INSTRUCTION =
  "The insurance check could not be completed. Tell the caller you weren't able to confirm their coverage right now, " +
  'and that the front desk will follow up. Do not guess at coverage or costs.'

const parseArguments = (raw: VapiToolCall['function']['arguments']): unknown => {
  if (typeof raw !== 'string') return raw ?? {}
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Runs the tool calls in one Vapi request. Each call gets exactly one result or error: Vapi ignores
 * non-200 responses, so failures have to travel inside the 200 as data the model can act on.
 */
export class VapiToolController {
  constructor(private readonly eligibility: Pick<EligibilityController, 'checkByCallerName'> = eligibilityController) {}

  async handleToolCalls(toolCalls: VapiToolCall[], ctx: RequestContext): Promise<VapiToolResult[]> {
    return Promise.all(toolCalls.map((toolCall) => this.handleToolCall(toolCall, ctx)))
  }

  private async handleToolCall(toolCall: VapiToolCall, ctx: RequestContext): Promise<VapiToolResult> {
    const toolCallId = toolCall.id
    const toolName = toolCall.function.name

    if (toolName !== 'check_insurance') {
      logger.warn('[VapiToolController] unknown tool', { requestId: ctx.requestId, toolCallId, toolName })
      return { toolCallId, error: `Unknown tool "${toolName}".` }
    }

    const params = CheckInsuranceParamsSchema.safeParse(parseArguments(toolCall.function.arguments))
    if (!params.success) {
      logger.warn('[VapiToolController] invalid tool arguments', {
        requestId: ctx.requestId,
        toolCallId,
        issue: params.error.issues[0]?.message,
      })
      return { toolCallId, error: "Missing the caller's name. Ask the caller for their first name, then try again." }
    }

    try {
      const result = await this.eligibility.checkByCallerName(params.data, ctx)
      return { toolCallId, result: JSON.stringify(result) }
    } catch (error) {
      logger.error(error as Error, '[VapiToolController] check_insurance failed', {
        requestId: ctx.requestId,
        toolCallId,
      })
      return { toolCallId, error: TOOL_FAILURE_INSTRUCTION }
    }
  }
}

export const vapiToolController = new VapiToolController()
