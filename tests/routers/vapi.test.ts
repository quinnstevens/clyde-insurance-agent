import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import app from '@clyde-api/server'
import { vapiToolController } from '@clyde-api/server/controllers/vapi/VapiToolController'

jest.mock('@clyde-api/server/controllers/vapi/VapiToolController', () => ({
  vapiToolController: { handleToolCalls: jest.fn() },
}))

const SECRET = 'test-secret'
const toolCallsBody = {
  message: {
    type: 'tool-calls',
    toolCallList: [{ id: 'call-1', type: 'function', function: { name: 'check_insurance', arguments: {} } }],
    call: { id: 'ignored' },
  },
}

describe('POST /vapi/tools', () => {
  let server: Server
  let baseUrl: string
  const originalSecret = process.env.VAPI_TOOL_SECRET

  beforeAll(async () => {
    process.env.VAPI_TOOL_SECRET = SECRET
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    process.env.VAPI_TOOL_SECRET = originalSecret
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  const post = (body: unknown, headers: Record<string, string> = { 'x-vapi-secret': SECRET }) =>
    fetch(`${baseUrl}/vapi/tools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('rejects a request without the shared secret', async () => {
    const response = await post(toolCallsBody, {})

    expect(response.status).toBe(401)
    expect(vapiToolController.handleToolCalls).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    const response = await post(toolCallsBody, { 'x-vapi-secret': 'nope' })

    expect(response.status).toBe(401)
  })

  it('accepts the secret as a bearer token', async () => {
    ;(vapiToolController.handleToolCalls as jest.Mock).mockResolvedValue([])

    const response = await post(toolCallsBody, { authorization: `Bearer ${SECRET}` })

    expect(response.status).toBe(200)
  })

  it('hands the tool calls to the controller and wraps the results for Vapi', async () => {
    const results = [{ toolCallId: 'call-1', result: '{"outcome":"unknown_caller"}' }]
    ;(vapiToolController.handleToolCalls as jest.Mock).mockResolvedValue(results)

    const response = await post(toolCallsBody)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results })
    expect(vapiToolController.handleToolCalls).toHaveBeenCalledWith(
      [{ id: 'call-1', function: { name: 'check_insurance', arguments: {} } }],
      expect.objectContaining({ requestId: expect.any(String) }),
    )
  })

  it('acknowledges other server message types without running tools', async () => {
    const response = await post({ message: { type: 'status-update' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(vapiToolController.handleToolCalls).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed body', async () => {
    const response = await post({ nope: true })

    expect(response.status).toBe(400)
  })
})
