import type { PayloadRequest } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Tickets } from '../../src/collections/Tickets'
import { aiHelp } from '../../src/endpoints/aiHelp'
import { AI_FAILURE_MESSAGES, AI_INPUT_MAX } from '../../src/lib/aiHelp'

let userId = 1000
const agent = () => ({ id: ++userId, roles: ['agent'] })

// A fake request. The payload object has a config and a logger only: no find, no db, so any
// attempt to read data would throw.
function fakeReq(user: unknown, body: unknown) {
  const logger = { warn: vi.fn() }
  const req = {
    user,
    json: async () => body,
    payload: {
      logger,
      config: { collections: [{ slug: 'tickets', labels: { plural: 'Tickets' }, fields: Tickets.fields }] },
    },
  } as unknown as PayloadRequest
  return { req, logger }
}

async function call(req: PayloadRequest) {
  const response = await aiHelp(req)
  return { status: response.status, body: (await response.json()) as { answer?: string; error?: string } }
}

const groqAnswer = (content: string) =>
  vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content } }] }))

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/ai-help: who may ask', () => {
  it('refuses a logged-out caller with 401 and a user without a staff role with 403', async () => {
    const fetchMock = groqAnswer('x')
    vi.stubGlobal('fetch', fetchMock)
    expect((await call(fakeReq(null, { question: 'hi' }).req)).status).toBe(401)
    expect((await call(fakeReq({ id: 5, roles: [] }, { question: 'hi' }).req)).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai-help: input', () => {
  it('refuses an empty question and one over the limit, without calling the model', async () => {
    const fetchMock = groqAnswer('x')
    vi.stubGlobal('fetch', fetchMock)
    expect((await call(fakeReq(agent(), { question: '  ' }).req)).status).toBe(400)
    const long = await call(fakeReq(agent(), { question: 'x'.repeat(AI_INPUT_MAX + 1) }).req)
    expect(long.status).toBe(400)
    expect(long.body.error).toMatch(/under 500 characters/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai-help: answers', () => {
  it('sends the field reference and the question only, and returns the answer', async () => {
    const fetchMock = groqAnswer('Priority sets the due date.')
    vi.stubGlobal('fetch', fetchMock)
    const { status, body } = await call(fakeReq(agent(), { question: 'What does priority do?', collection: 'tickets' }).req)

    expect(status).toBe(200)
    expect(body).toEqual({ answer: 'Priority sets the due date.' })
    const sent = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { messages: { role: string; content: string }[] }
    expect(sent.messages).toHaveLength(2)
    expect(sent.messages[0]!.content).toContain('Field reference for "Tickets"')
    expect(sent.messages[0]!.content).toContain('- Priority (priority, select, required)')
    expect(sent.messages[1]!.content).toBe('What does priority do?')
  })

  it('falls back to the tickets fields for an unknown collection', async () => {
    const fetchMock = groqAnswer('ok')
    vi.stubGlobal('fetch', fetchMock)
    await call(fakeReq(agent(), { question: 'hi', collection: 'payload-preferences' }).req)
    const sent = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { messages: { content: string }[] }
    expect(sent.messages[0]!.content).toContain('Field reference for "Tickets"')
  })
})

describe('POST /api/ai-help: failures stay friendly', () => {
  it('says the help is not set up when there is no key, without calling the model', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    const fetchMock = groqAnswer('x')
    vi.stubGlobal('fetch', fetchMock)
    const { status, body } = await call(fakeReq(agent(), { question: 'hi' }).req)
    expect(status).toBe(503)
    expect(body.error).toBe(AI_FAILURE_MESSAGES.not_configured)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a Groq error', async () => new Response('', { status: 500 }), 502, AI_FAILURE_MESSAGES.unavailable],
    ['a Groq rate limit', async () => new Response('', { status: 429 }), 429, AI_FAILURE_MESSAGES.busy],
    ['a network error', async () => Promise.reject(new TypeError('fetch failed')), 502, AI_FAILURE_MESSAGES.unavailable],
    [
      'a timeout',
      async () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
      504,
      AI_FAILURE_MESSAGES.timeout,
    ],
  ])('answers %s with a message, and logs the outcome without the question', async (_case, impl, code, message) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(impl as typeof fetch))
    const { req, logger } = fakeReq(agent(), { question: 'secret question text' })
    const { status, body } = await call(req)
    expect(status).toBe(code)
    expect(body).toEqual({ error: message })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret question text')
  })

  it('limits one user to 10 questions a minute', async () => {
    vi.stubGlobal('fetch', groqAnswer('ok'))
    const user = agent()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await call(fakeReq(user, { question: `q${i}` }).req)).status)
    }
    expect(statuses.slice(0, 10).every((code) => code === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
