import type { PayloadHandler } from 'payload'

import { isStaff } from '../lib/access'
import {
  AI_FAILURE_MESSAGES,
  buildMessages,
  checkQuestion,
  collectFieldHelp,
  createRateLimiter,
  toHelpCollection,
} from '../lib/aiHelp'
import { env } from '../lib/env'
import { askGroq, DEFAULT_GROQ_MODEL } from '../lib/groq'

// 10 questions per user per minute. Groq's free plan allows 30 per minute for the whole app.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 })

// POST /api/ai-help  { question: string, collection?: string }
//
// Answers "what does this field mean / how do I fill this in" from the collection's field
// metadata only. Staff only, checked here on the server. A failure of the AI never becomes
// an error page: the reply is a friendly message the widget shows.
export const aiHelp: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Log in to use the AI help.' }, { status: 401 })
  }
  if (!isStaff({ req })) {
    return Response.json({ error: 'Only staff can use the AI help.' }, { status: 403 })
  }

  let body: { question?: unknown; collection?: unknown }
  try {
    body = (await req.json?.()) ?? {}
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }
  const check = checkQuestion(body.question)
  if (!check.ok) {
    return Response.json({ error: check.error }, { status: 400 })
  }

  if (!limiter.allow(String(req.user.id), Date.now())) {
    return Response.json({ error: 'You asked a lot in a short time. Wait a minute and try again.' }, { status: 429 })
  }

  const apiKey = env.groqApiKey()
  if (!apiKey) {
    return Response.json({ error: AI_FAILURE_MESSAGES.not_configured }, { status: 503 })
  }

  // Field metadata from the config. Nothing here reads the database.
  const slug = toHelpCollection(body.collection)
  const collection = req.payload.config.collections.find((entry) => entry.slug === slug)
  const fields = collectFieldHelp(collection?.fields ?? [])
  const label = typeof collection?.labels?.plural === 'string' ? collection.labels.plural : slug

  const result = await askGroq({
    apiKey,
    model: env.groqModel() ?? DEFAULT_GROQ_MODEL,
    messages: buildMessages({ question: check.question, collectionLabel: label, fields }),
    fetch,
  })
  if (!result.ok) {
    // Logs the outcome only. The question is not logged.
    req.payload.logger.warn({ failure: result.failure, status: result.status }, '[ai-help] no answer')
    const status = result.failure === 'timeout' ? 504 : result.failure === 'busy' ? 429 : 502
    return Response.json({ error: AI_FAILURE_MESSAGES[result.failure] }, { status })
  }
  return Response.json({ answer: result.answer })
}
