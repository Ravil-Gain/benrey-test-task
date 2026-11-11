// The one call to Groq's chat completions API. `fetch` is passed in, so the unit tests can
// run every outcome without the network.

import { AI_TIMEOUT_MS, readAnswer, type AiFailure, type ChatMessage } from './aiHelp'

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b'

export type GroqResult =
  { ok: true; answer: string } | { ok: false; failure: AiFailure; status?: number }

export async function askGroq(input: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  fetch: typeof fetch
  timeoutMs?: number
}): Promise<GroqResult> {
  let response: Response
  try {
    response = await input.fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: 0.2,
        // gpt-oss reasons before answering and those tokens count too. Low effort keeps the
        // call inside the timeout; the reasoning itself is not returned.
        max_completion_tokens: 700,
        reasoning_effort: 'low',
        include_reasoning: false,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? AI_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as { name?: unknown })?.name
    return {
      ok: false,
      failure: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable',
    }
  }

  if (response.status === 429) {
    return { ok: false, failure: 'busy', status: 429 }
  }
  if (!response.ok) {
    return { ok: false, failure: 'unavailable', status: response.status }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    const name = (error as { name?: unknown })?.name
    const failure = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable'
    return { ok: false, failure, status: response.status }
  }
  const answer = readAnswer(body)
  return answer ? { ok: true, answer } : { ok: false, failure: 'empty' }
}
