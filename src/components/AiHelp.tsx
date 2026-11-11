'use client'

import { Button, useAuth } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import { AI_INPUT_MAX, HELP_COLLECTIONS, toHelpCollection } from '../lib/aiHelp'

const COLLECTION_LABELS: Record<(typeof HELP_COLLECTIONS)[number], string> = {
  tickets: 'Tickets',
  customers: 'Customers',
  tags: 'Tags',
  media: 'Media',
  users: 'Users',
}

// Wraps the admin (admin.components.providers) to add a "Field help" button on every admin
// page for logged-in users. It asks POST /api/ai-help about the form that is open. The answer
// is shown as plain text, never as HTML. Any failure shows a message and nothing else.
export function AiHelpProvider({ children }: { children?: ReactNode }) {
  const { user } = useAuth()
  return (
    <>
      {children}
      {user ? <AiHelpWidget /> : null}
    </>
  )
}

function AiHelpWidget() {
  const pathname = usePathname()
  const slug = toHelpCollection(pathname?.match(/\/collections\/([^/]+)/)?.[1])
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<{ kind: 'answer' | 'error'; text: string } | null>(null)

  async function ask() {
    const text = question.trim()
    if (!text || busy) return
    setBusy(true)
    setReply(null)
    try {
      const response = await fetch('/api/ai-help', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, collection: slug }),
      })
      const body = (await response.json().catch(() => null)) as { answer?: string; error?: string } | null
      if (response.ok && body?.answer) {
        setReply({ kind: 'answer', text: body.answer })
      } else {
        setReply({ kind: 'error', text: body?.error ?? 'The AI help is unavailable right now.' })
      }
    } catch {
      setReply({ kind: 'error', text: 'The AI help could not be reached. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open field help"
        style={{ ...floating, padding: '8px 14px', borderRadius: 999, cursor: 'pointer' }}
      >
        Field help
      </button>
    )
  }

  return (
    <div role="dialog" aria-label="Field help" style={{ ...floating, width: 'min(360px, calc(100vw - 32px))', padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Field help: {COLLECTION_LABELS[slug]}</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close field help" style={closeButton}>
          ×
        </button>
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 12, opacity: 0.8 }}>
        Ask what a field means or how to fill it in. Answers come from the field descriptions only.
        Do not paste customer data.
      </p>
      <textarea
        value={question}
        maxLength={AI_INPUT_MAX}
        rows={3}
        disabled={busy}
        placeholder="For example: when does a ticket become overdue?"
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void ask()
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          background: 'var(--theme-input-bg)',
          color: 'var(--theme-text)',
          border: '1px solid var(--theme-elevation-150)',
          borderRadius: 'var(--style-radius-s)',
          padding: 8,
          font: 'inherit',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {question.length} / {AI_INPUT_MAX}
        </span>
        <Button buttonStyle="primary" size="small" margin={false} disabled={busy || !question.trim()} onClick={ask}>
          {busy ? 'Thinking…' : 'Ask'}
        </Button>
      </div>
      {reply ? (
        <div
          role={reply.kind === 'error' ? 'alert' : 'status'}
          style={{
            marginTop: 10,
            whiteSpace: 'pre-wrap',
            maxHeight: 240,
            overflowY: 'auto',
            color: reply.kind === 'error' ? 'var(--theme-error-500)' : undefined,
          }}
        >
          {reply.text}
        </div>
      ) : null}
    </div>
  )
}

const floating = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  zIndex: 50,
  background: 'var(--theme-elevation-50)',
  color: 'var(--theme-text)',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 'var(--style-radius-m)',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
} as const

const closeButton = {
  background: 'none',
  border: 'none',
  color: 'var(--theme-text)',
  fontSize: 18,
  cursor: 'pointer',
  lineHeight: 1,
} as const
