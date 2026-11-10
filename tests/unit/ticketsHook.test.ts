import { ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'

import { beforeTicketChange } from '../../src/hooks/tickets'
import type { Ticket } from '../../src/payload-types'

type HookArgs = Parameters<typeof beforeTicketChange>[0]
type Data = Partial<Ticket> & Record<string, unknown>

function run(operation: 'create' | 'update', data: Data, originalDoc?: Data, user: unknown = { id: 7 }) {
  return beforeTicketChange({
    data,
    originalDoc,
    operation,
    req: { user, t: (key: string) => key },
  } as unknown as HookArgs) as Data
}

function statusError(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError)
    const { errors } = (error as ValidationError).data
    expect(errors[0]!.path).toBe('status')
    return errors[0]!.message
  }
  throw new Error('expected a ValidationError')
}

describe('beforeTicketChange on create', () => {
  it('accepts a new ticket and sets its due date from the priority', () => {
    const before = Date.now()
    const data = run('create', { status: 'new', priority: 'urgent' })
    const due = new Date(data.dueAt as string).getTime()
    expect(due).toBeGreaterThan(before)
    expect(due - before).toBeLessThanOrEqual(4 * 3600_000 + 1000)
  })

  it('treats a missing status as New', () => {
    expect(() => run('create', { priority: 'normal' })).not.toThrow()
  })

  it('refuses every other start status, including ones one step from New', () => {
    for (const status of ['in_progress', 'waiting_customer', 'resolved', 'closed'] as const) {
      expect(statusError(() => run('create', { status, assignee: 3 }))).toMatch(
        /A new ticket starts as "New", not /,
      )
    }
  })

  it('sets no resolved or closed time on create', () => {
    const data = run('create', { status: 'new' })
    expect(data.resolvedAt).toBeUndefined()
    expect(data.closedAt).toBeUndefined()
  })
})

describe('beforeTicketChange on update', () => {
  const original = { status: 'in_progress', assignee: 3 } as Data

  it('allows a workflow step and stamps resolvedAt', () => {
    const data = run('update', { status: 'resolved' }, original)
    expect(typeof data.resolvedAt).toBe('string')
  })

  it('stamps closedAt when a ticket is closed, and not again when it stays closed', () => {
    const closing = run('update', { status: 'closed' }, { status: 'resolved' } as Data)
    expect(typeof closing.closedAt).toBe('string')
    const unchanged = run('update', { status: 'closed', priority: 'low' }, { status: 'closed' } as Data)
    expect(unchanged.closedAt).toBeUndefined()
  })

  it('refuses a step outside the workflow', () => {
    expect(statusError(() => run('update', { status: 'new' }, original))).toBe(
      'Cannot change status from "In progress" to "New".',
    )
  })

  it('uses the assignee being saved, not only the stored one', () => {
    const waiting = { status: 'waiting_customer', assignee: 3 } as Data
    expect(statusError(() => run('update', { status: 'in_progress', assignee: null }, waiting))).toMatch(
      /Assign an agent/,
    )
    const unassigned = { status: 'new', assignee: null } as Data
    expect(() => run('update', { status: 'in_progress', assignee: 5 }, unassigned)).not.toThrow()
  })

  it('leaves other fields alone when the status does not change', () => {
    const closed = { status: 'closed' } as Data
    expect(() => run('update', { status: 'closed', priority: 'high' }, closed)).not.toThrow()
  })
})

describe('beforeTicketChange comments', () => {
  it('sets author and time on new comments from the server, ignoring what the client sent', () => {
    const data = run('update', { comments: [{ body: 'hi', author: 99, createdAt: '2000-01-01' }] }, {
      status: 'new',
      comments: [],
    } as Data)
    const [comment] = data.comments as { author: unknown; createdAt: string }[]
    expect(comment!.author).toBe(7)
    expect(comment!.createdAt).not.toBe('2000-01-01')
  })

  it('keeps author and time of comments that already exist', () => {
    const old = { id: 'c1', body: 'old', author: 2, createdAt: '2026-01-01T00:00:00.000Z' }
    const data = run('update', { comments: [{ ...old, body: 'edited', author: 99 }] }, {
      status: 'new',
      comments: [old],
    } as Data)
    const [comment] = data.comments as { author: unknown; createdAt: string }[]
    expect(comment!.author).toBe(2)
    expect(comment!.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
