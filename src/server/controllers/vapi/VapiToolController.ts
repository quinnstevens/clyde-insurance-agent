import {
  eligibilityController,
  type EligibilityController,
} from '@clyde-api/server/controllers/eligibility/EligibilityController'
import { CheckInsuranceParamsSchema, VerifyCallerParamsSchema } from '@clyde-api/server/controllers/eligibility/schemas'
import { faqAnswerController, type FaqAnswerController } from '@clyde-api/server/controllers/faq/FaqAnswerController'
import { AnswerQuestionParamsSchema } from '@clyde-api/server/controllers/faq/schemas'
import type { RequestContext } from '@clyde-api/types/context'
import logger from '@clyde-api/utils/logger'
import type { VapiToolCall, VapiToolResult } from './schemas'

// Read by the model, not the caller: tell it what to do next, never expose internals.
const TOOL_FAILURE_INSTRUCTION =
  "The insurance check could not be completed. Tell the caller you weren't able to confirm their coverage right now, " +
  'and that the front desk will follow up. Do not guess at coverage or costs.'

const VERIFY_FAILURE_INSTRUCTION =
  "The caller's record could not be looked up. Tell the caller you can't pull up their record right now. You can " +
  "still answer general questions about the clinic, but don't share anything about their account."

const MISSING_IDENTITY_INSTRUCTION =
  'Missing or unreadable first name or date of birth. Ask the caller for whichever is missing, or to say their ' +
  'date of birth again as month, day and year, then try again.'

const FAQ_FAILURE_INSTRUCTION =
  "The question could not be looked up. Tell the caller you can't answer that right now and that the front desk can " +
  'help. Do not answer it from your own knowledge.'

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
  constructor(
    private readonly eligibility: Pick<
      EligibilityController,
      'checkByCallerName' | 'verifyCaller'
    > = eligibilityController,
    private readonly faqs: Pick<FaqAnswerController, 'answer'> = faqAnswerController,
  ) {}

  async handleToolCalls(toolCalls: VapiToolCall[], ctx: RequestContext): Promise<VapiToolResult[]> {
    return Promise.all(toolCalls.map((toolCall) => this.handleToolCall(toolCall, ctx)))
  }

  private async handleToolCall(toolCall: VapiToolCall, ctx: RequestContext): Promise<VapiToolResult> {
    const toolCallId = toolCall.id
    const toolName = toolCall.function.name
    const args = parseArguments(toolCall.function.arguments)

    if (toolName === 'verify_caller') {
      const params = VerifyCallerParamsSchema.safeParse(args)
      if (!params.success) {
        this.warnInvalid(toolCallId, params.error.issues[0]?.message, ctx)
        return { toolCallId, error: MISSING_IDENTITY_INSTRUCTION }
      }
      return this.run(toolCallId, toolName, VERIFY_FAILURE_INSTRUCTION, ctx, () =>
        this.eligibility.verifyCaller(params.data, ctx),
      )
    }

    if (toolName === 'check_insurance') {
      const params = CheckInsuranceParamsSchema.safeParse(args)
      if (!params.success) {
        this.warnInvalid(toolCallId, params.error.issues[0]?.message, ctx)
        return { toolCallId, error: MISSING_IDENTITY_INSTRUCTION }
      }
      return this.run(toolCallId, toolName, TOOL_FAILURE_INSTRUCTION, ctx, () =>
        this.eligibility.checkByCallerName(params.data, ctx),
      )
    }

    if (toolName === 'answer_question') {
      const params = AnswerQuestionParamsSchema.safeParse(args)
      if (!params.success) {
        this.warnInvalid(toolCallId, params.error.issues[0]?.message, ctx)
        return { toolCallId, error: "Missing the caller's question. Ask what they'd like to know, then try again." }
      }
      return this.run(toolCallId, toolName, FAQ_FAILURE_INSTRUCTION, ctx, async () => {
        // The agent only needs what to say; scores and thresholds are for the clinic's test box.
        const { outcome, say, faq_id, options: choices } = await this.faqs.answer(params.data, { record: true }, ctx)
        return { outcome, say, faq_id, options: choices }
      })
    }

    logger.warn('[VapiToolController] unknown tool', { requestId: ctx.requestId, toolCallId, toolName })
    return { toolCallId, error: `Unknown tool "${toolName}".` }
  }

  private async run(
    toolCallId: string,
    toolName: string,
    failureInstruction: string,
    ctx: RequestContext,
    fn: () => Promise<unknown>,
  ): Promise<VapiToolResult> {
    try {
      return { toolCallId, result: JSON.stringify(await fn()) }
    } catch (error) {
      logger.error(error as Error, `[VapiToolController] ${toolName} failed`, { requestId: ctx.requestId, toolCallId })
      return { toolCallId, error: failureInstruction }
    }
  }

  private warnInvalid(toolCallId: string, issue: string | undefined, ctx: RequestContext) {
    logger.warn('[VapiToolController] invalid tool arguments', { requestId: ctx.requestId, toolCallId, issue })
  }
}

export const vapiToolController = new VapiToolController()
