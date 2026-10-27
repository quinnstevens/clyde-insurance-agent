import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import app from '@clyde-api/server'
import { faqAnswerController } from '@clyde-api/server/controllers/faq/FaqAnswerController'
import { faqController } from '@clyde-api/server/controllers/faq/FaqController'

jest.mock('@clyde-api/server/controllers/faq/FaqController', () => ({
  faqController: { list: jest.fn(), create: jest.fn(), listCallerQuestions: jest.fn() },
}))
jest.mock('@clyde-api/server/controllers/faq/FaqAnswerController', () => ({
  faqAnswerController: { answer: jest.fn() },
}))

const KEY = 'admin-test-key'

describe('FAQ admin API', () => {
  let server: Server
  let baseUrl: string
  const originalKey = process.env.ADMIN_API_KEY

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = KEY
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    process.env.ADMIN_API_KEY = originalKey
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  const request = (path: string, init: RequestInit = {}, key: string | null = KEY) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
    })

  it('rejects requests without the admin key', async () => {
    expect((await request('/faqs', {}, null)).status).toBe(401)
    expect((await request('/caller-questions', {}, 'wrong')).status).toBe(401)
    expect(faqController.list).not.toHaveBeenCalled()
  })

  it('does not accept the Vapi tool secret header in place of the admin key', async () => {
    const response = await fetch(`${baseUrl}/faqs`, { headers: { 'x-vapi-secret': KEY } })

    expect(response.status).toBe(401)
  })

  it('lists FAQs with the key', async () => {
    ;(faqController.list as jest.Mock).mockResolvedValue([])

    const response = await request('/faqs?active=true&search=parking')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ faqs: [] })
    expect(faqController.list).toHaveBeenCalledWith({ active: 'true', search: 'parking' }, expect.anything())
  })

  it('validates a new FAQ before it reaches the controller', async () => {
    const response = await request('/faqs', { method: 'POST', body: JSON.stringify({ question: 'Hours?' }) })

    expect(response.status).toBe(400)
    expect(faqController.create).not.toHaveBeenCalled()
  })

  it('runs the test box without recording anything', async () => {
    ;(faqAnswerController.answer as jest.Mock).mockResolvedValue({ outcome: 'unanswered' })

    const response = await request('/faqs/test', { method: 'POST', body: JSON.stringify({ question: 'hi' }) })

    expect(response.status).toBe(200)
    expect(faqAnswerController.answer).toHaveBeenCalledWith({ question: 'hi' }, { record: false }, expect.anything())
  })
})
