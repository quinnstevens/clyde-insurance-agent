import { z } from 'zod'
import { AppError } from '@clyde-api/types/errors'
import { OpenAIClient } from '@clyde-api/utils/openai'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('OpenAIClient', () => {
  const ctx = { requestId: 'test-request' }

  describe('embed', () => {
    it('sends the inputs with the embedding model and returns vectors in input order', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        jsonResponse({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      )
      const client = new OpenAIClient(() => 'sk-test', fetchImpl)

      const vectors = await client.embed(['first', 'second'], ctx)

      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toBe('https://api.openai.com/v1/embeddings')
      expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' })
      expect(JSON.parse(init.body)).toEqual({ model: 'text-embedding-3-small', input: ['first', 'second'] })
      expect(vectors).toEqual([
        [1, 0],
        [0, 1],
      ])
    })

    it('skips the request for no inputs', async () => {
      const fetchImpl = jest.fn()

      expect(await new OpenAIClient(() => 'sk-test', fetchImpl).embed([], ctx)).toEqual([])
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('refuses to run without an API key', async () => {
      const client = new OpenAIClient(() => undefined, jest.fn())

      expect(client.configured).toBe(false)
      await expect(client.embed(['q'], ctx)).rejects.toThrow('OPENAI_API_KEY is not set')
    })

    it('turns an error status into an AppError', async () => {
      const client = new OpenAIClient(() => 'sk-test', jest.fn().mockResolvedValue(jsonResponse({}, 429)))

      await expect(client.embed(['q'], ctx)).rejects.toMatchObject({ code: 'external_api_error' })
    })

    it('turns a timeout into a timeout AppError', async () => {
      const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
      const client = new OpenAIClient(() => 'sk-test', jest.fn().mockRejectedValue(timeout))

      const error = await client.embed(['q'], ctx).catch((e) => e)
      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('timeout')
    })
  })

  describe('chatJson', () => {
    const schema = z.object({ decision: z.string() })
    const jsonSchema = { name: 'test', schema: { type: 'object' } }

    it('asks for strict JSON output and parses it', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{"decision":"match"}' } }] }))
      const client = new OpenAIClient(() => 'sk-test', fetchImpl)

      const result = await client.chatJson([{ role: 'user', content: 'hi' }], jsonSchema, schema, ctx)

      expect(result).toEqual({ decision: 'match' })
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
      expect(body).toMatchObject({
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'test', strict: true } },
      })
    })

    it('rejects output that does not match the schema', async () => {
      const client = new OpenAIClient(
        () => 'sk-test',
        jest.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'not json' } }] })),
      )

      await expect(client.chatJson([], jsonSchema, schema, ctx)).rejects.toMatchObject({ code: 'external_api_error' })
    })
  })
})
