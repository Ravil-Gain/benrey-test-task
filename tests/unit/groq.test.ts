import { describe, expect, it, vi } from 'vitest'

import { askGroq, DEFAULT_GROQ_MODEL, GROQ_URL } from '../../src/lib/groq'

const messages = [
  { role: 'system' as const, content: 'rules' },
  { role: 'user' as const, content: 'What is priority?' },
]

function call(fetchImpl: typeof fetch, timeoutMs?: number) {
  return askGroq({
    apiKey: 'test-key',
    model: DEFAULT_GROQ_MODEL,
    messages,
    fetch: fetchImpl,
    timeoutMs,
  })
}

describe('askGroq', () => {
  it('sends the model, the messages, the key, short-answer settings and a timeout signal', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ message: { content: 'It sets the due date.' } }] }),
    )
    expect(await call(fetchMock)).toEqual({ ok: true, answer: 'It sets the due date.' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(GROQ_URL)
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    expect(init!.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject({
      model: 'openai/gpt-oss-20b',
      messages,
      reasoning_effort: 'low',
      include_reasoning: false,
    })
    expect(body.max_completion_tokens).toBeLessThanOrEqual(1000)
  })

  it('reports a timeout when the request takes longer than the limit', async () => {
    const slow = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
        }),
    )
    expect(await call(slow, 20)).toEqual({ ok: false, failure: 'timeout' })
  })

  it('maps a 429 to busy and other errors to unavailable', async () => {
    expect(await call(async () => new Response('', { status: 429 }))).toEqual({
      ok: false,
      failure: 'busy',
      status: 429,
    })
    expect(await call(async () => new Response('', { status: 500 }))).toEqual({
      ok: false,
      failure: 'unavailable',
      status: 500,
    })
    expect(await call(async () => new Response('', { status: 401 }))).toMatchObject({
      failure: 'unavailable',
    })
  })

  it('maps a network error and a broken body to unavailable', async () => {
    expect(await call(async () => Promise.reject(new TypeError('fetch failed')))).toEqual({
      ok: false,
      failure: 'unavailable',
    })
    expect(await call(async () => new Response('not json', { status: 200 }))).toMatchObject({
      failure: 'unavailable',
    })
  })

  it('reports an empty answer', async () => {
    expect(
      await call(async () => Response.json({ choices: [{ message: { content: '' } }] })),
    ).toEqual({
      ok: false,
      failure: 'empty',
    })
  })
})
