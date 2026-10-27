import { z } from 'zod'
import { CHAT_MODEL, EMBEDDING_MODEL } from '@clyde-api/config/faq'
import type { RequestContext } from '@clyde-api/types/context'
import { AppError } from '@clyde-api/types/errors'
import logger from '@clyde-api/utils/logger'

const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const CHAT_URL = 'https://api.openai.com/v1/chat/completions'
// Embedding a batch for import can take a while; a single question on a live call should not.
const EMBED_TIMEOUT_MS = 20_000
const CHAT_TIMEOUT_MS = 8_000

const EmbeddingsResponseSchema = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
})

const ChatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
})

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/**
 * Thin client for the two OpenAI calls the FAQ agent makes. Throws `AppError`s; never logs inputs or
 * outputs, since caller questions can contain health details.
 */
export class OpenAIClient {
  constructor(
    private readonly getApiKey: () => string | undefined = () => process.env.OPENAI_API_KEY,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get configured(): boolean {
    return Boolean(this.getApiKey())
  }

  /** One vector per input, in input order. */
  async embed(inputs: string[], ctx: RequestContext): Promise<number[][]> {
    if (inputs.length === 0) return []
    const body = await this.post(EMBEDDINGS_URL, { model: EMBEDDING_MODEL, input: inputs }, EMBED_TIMEOUT_MS, ctx)
    const parsed = EmbeddingsResponseSchema.safeParse(body)
    if (!parsed.success || parsed.data.data.length !== inputs.length) {
      throw AppError.externalApi('OpenAI embeddings response was not in the expected shape', parsed.error, {
        requestId: ctx.requestId,
      })
    }
    return [...parsed.data.data].sort((a, b) => a.index - b.index).map((item) => item.embedding)
  }

  /** A chat completion constrained to `jsonSchema`, parsed and checked with `schema`. */
  async chatJson<T>(
    messages: ChatMessage[],
    jsonSchema: { name: string; schema: Record<string, unknown> },
    schema: z.ZodType<T>,
    ctx: RequestContext,
  ): Promise<T> {
    const body = await this.post(
      CHAT_URL,
      {
        model: CHAT_MODEL,
        temperature: 0,
        messages,
        response_format: { type: 'json_schema', json_schema: { ...jsonSchema, strict: true } },
      },
      CHAT_TIMEOUT_MS,
      ctx,
    )
    const content = ChatResponseSchema.safeParse(body).data?.choices[0].message.content
    let json: unknown = null
    try {
      json = content ? JSON.parse(content) : null
    } catch {
      // handled below
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      throw AppError.externalApi('OpenAI chat response was not in the expected shape', parsed.error, {
        requestId: ctx.requestId,
      })
    }
    return parsed.data
  }

  private async post(url: string, payload: unknown, timeoutMs: number, ctx: RequestContext): Promise<unknown> {
    const apiKey = this.getApiKey()
    if (!apiKey) throw AppError.internal('OPENAI_API_KEY is not set', undefined, { requestId: ctx.requestId })

    const meta = { requestId: ctx.requestId, url }
    const startedAt = Date.now()
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw AppError.timeout('OpenAI request timed out', { ...meta, timeoutMs })
      }
      throw AppError.externalApi('OpenAI request failed', error as Error, meta)
    }

    const durationMs = Date.now() - startedAt
    if (!response.ok) {
      throw AppError.externalApi(`OpenAI returned ${response.status}`, undefined, {
        ...meta,
        status: response.status,
        durationMs,
      })
    }
    logger.debug('[OpenAIClient] request completed', { ...meta, durationMs })
    return response.json().catch(() => null)
  }
}

export const openai = new OpenAIClient()
