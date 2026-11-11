'use client'

import { Button, useConfig } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { AI_INPUT_MAX, toHelpCollection } from '../lib/aiHelp'
import './AiHelp.scss'

type Reply = { kind: 'answer' | 'error'; text: string }

// The "Field help" button in the admin header (admin.components.actions). It asks
// POST /api/ai-help about the collection whose page is open and shows the answer as plain
// text. Any failure shows a message; the admin never depends on it.
export function AiHelp() {
  const pathname = usePathname()
  const { getEntityConfig } = useConfig()
  const slug = toHelpCollection(pathname?.match(/\/collections\/([^/]+)/)?.[1])
  const plural = getEntityConfig({ collectionSlug: slug })?.labels?.plural
  const label = typeof plural === 'string' ? plural : slug

  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply | null>(null)

  async function ask() {
    const text = question.trim()
    if (!text || busy) {
      return
    }
    setBusy(true)
    setReply(null)
    try {
      const response = await fetch('/api/ai-help', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, collection: slug }),
      })
      const body = (await response.json().catch(() => null)) as {
        answer?: string
        error?: string
      } | null
      if (response.ok && body?.answer) {
        setReply({ kind: 'answer', text: body.answer })
      } else {
        setReply({ kind: 'error', text: body?.error ?? 'The AI help is unavailable right now.' })
      }
    } catch {
      setReply({
        kind: 'error',
        text: 'The AI help could not be reached. Check your connection and try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        aria-label={open ? 'Close field help' : 'Open field help'}
        buttonStyle="pill"
        margin={false}
        onClick={() => setOpen((value) => !value)}
        size="small"
      >
        Field help
      </Button>
      {open ? (
        <div aria-label="Field help" className="ai-help" role="dialog">
          <div className="ai-help__header">
            <strong>Field help: {label}</strong>
            <button
              aria-label="Close field help"
              className="ai-help__close"
              onClick={() => setOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <p className="ai-help__hint">
            Ask what a field means or how to fill it in. Answers come from the field descriptions
            only. Do not paste customer data.
          </p>
          <textarea
            className="ai-help__question"
            disabled={busy}
            maxLength={AI_INPUT_MAX}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void ask()
            }}
            placeholder="For example: when does a ticket become overdue?"
            rows={3}
            value={question}
          />
          <div className="ai-help__footer">
            <span className="ai-help__count">
              {question.length} / {AI_INPUT_MAX}
            </span>
            <Button
              buttonStyle="primary"
              disabled={busy || !question.trim()}
              margin={false}
              onClick={ask}
              size="small"
            >
              {busy ? 'Thinking…' : 'Ask'}
            </Button>
          </div>
          {reply ? (
            <div
              className={`ai-help__reply${reply.kind === 'error' ? ' ai-help__reply--error' : ''}`}
              role={reply.kind === 'error' ? 'alert' : 'status'}
            >
              {reply.text}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
