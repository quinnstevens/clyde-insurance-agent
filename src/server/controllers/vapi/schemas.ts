import { z } from 'zod'

/**
 * One tool call from Vapi. `arguments` is documented as an object, but accept a JSON string too:
 * OpenAI-style function calls carry their arguments that way, and rejecting it would drop the call.
 */
export const VapiToolCallSchema = z.object({
  id: z.string({ error: 'toolCall.id is required' }).min(1),
  function: z.object({
    name: z.string({ error: 'toolCall.function.name is required' }).min(1),
    arguments: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
  }),
})

export type VapiToolCall = z.infer<typeof VapiToolCallSchema>

/**
 * Body Vapi POSTs to a tool's server URL. Only the fields we use are declared; the rest (assistant,
 * artifact, most of call) are passed through and ignored.
 */
export const VapiServerMessageBodySchema = z.object({
  message: z.looseObject({
    type: z.string({ error: 'message.type is required' }),
    toolCallList: z.array(VapiToolCallSchema).optional(),
    call: z.looseObject({ id: z.string().optional() }).optional(),
  }),
})

/** One entry of the `results` array Vapi expects back. Exactly one of `result` / `error` is set. */
export interface VapiToolResult {
  toolCallId: string
  result?: string
  error?: string
}
