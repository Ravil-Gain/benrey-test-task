import { ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'

import { beforeTicketChange } from '../../src/hooks/tickets'
import type { Ticket } from '../../src/payload-types'

type HookArgs = Parameters<typeof beforeTicketChange>[0]
type Data = Partial<Ticket> & Record<string, unknown>

const HOUR = 3600_000
const agent = { id: 7, roles: ['agent'] }
const admin = { id: 1, roles: ['admin'] }
const createdAt = '2026-11-01T10:00:00.000Z'

function run(
  operation: 'create' | 'update',
  data: Data,
  originalDoc?: Data,
  user: unknown = agent,
) {
  return beforeTicketChange({
    data,
    originalDoc,
    operation,
    req: { user, t: (key: string) => key },
  } as unknown as HookArgs) as Data
}

function failure(fn: () => unknown): { path: string; message: string } {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError)
    const [first] = (error as ValidationError).data.errors
    return { path: first!.path, message: first!.message }
  }
  throw new Error('expected a ValidationError')
}

describe('beforeTicketChange on create', () => {
  it('sets the due date from the priority and the creation time', () => {
    const data = run('create', { status: 'new', priority: 'urgent', createdAt })
    expect(data.dueAt).toBe('2026-11-01T14:00:00.000Z')
  })

  it('counts from now when no creation time is given', () => {
    const before = Date.now()
    const data = run('create', { priority: 'low' })
    const due = new Date(data.dueAt as string).getTime() - before
    expect(due).toBeGreaterThanOrEqual(168 * HOUR)
    expect(due).toBeLessThan(168 * HOUR + 1000)
  })

  it('refuses every start status but New', () => {
    for (const status of ['in_progress', 'waiting_customer', 'resolved', 'closed'] as const) {
      expect(failure(() => run('create', { status, assignee: 3 }))).toMatchObject({
        path: 'status',
        message: expect.stringMatching(/A new ticket starts as "New", not /),
      })
    }
  })

  it('clears resolved and closed times, whatever the client sent', () => {
    const data = run('create', { status: 'new', resolvedAt: '2026-01-01', closedAt: '2026-01-01' })
    expect(data.resolvedAt).toBeNull()
    expect(data.closedAt).toBeNull()
  })
})

describe('beforeTicketChange on update: status', () => {
  const inProgress = { status: 'in_progress', assignee: 3, priority: 'normal', createdAt } as Data

  it('allows a workflow step and stamps resolvedAt', () => {
    const data = run('update', { status: 'resolved' }, inProgress)
    expect(typeof data.resolvedAt).toBe('string')
  })

  it('stamps closedAt when a ticket is closed, and not again when it stays closed', () => {
    const closing = run('update', { status: 'closed' }, { ...inProgress, status: 'resolved' })
    expect(typeof closing.closedAt).toBe('string')
    const unchanged = run('update', { status: 'closed' }, { ...inProgress, status: 'closed' })
    expect(unchanged.closedAt).toBeUndefined()
  })

  it('clears resolvedAt when a resolved ticket is reopened', () => {
    const resolved = {
      ...inProgress,
      status: 'resolved',
      resolvedAt: '2026-11-02T00:00:00.000Z',
    } as Data
    expect(run('update', { status: 'in_progress' }, resolved).resolvedAt).toBeNull()
    expect(run('update', { status: 'closed' }, resolved).resolvedAt).toBeUndefined()
  })

  it('refuses a step outside the workflow', () => {
    expect(failure(() => run('update', { status: 'new' }, inProgress))).toEqual({
      path: 'status',
      message: 'Cannot change status from "In progress" to "New".',
    })
  })

  it('leaves the timestamps alone when the status does not change', () => {
    const data = run(
      'update',
      { status: 'closed', priority: 'high' },
      { ...inProgress, status: 'closed' },
    )
    expect(data.closedAt).toBeUndefined()
    expect(data.resolvedAt).toBeUndefined()
  })
})

describe('beforeTicketChange on update: assignee', () => {
  it('refuses moving to In progress without an assignee, using the value being saved', () => {
    const waiting = { status: 'waiting_customer', assignee: 3, createdAt } as Data
    expect(
      failure(() => run('update', { status: 'in_progress', assignee: null }, waiting)),
    ).toMatchObject({
      path: 'status',
      message: expect.stringMatching(/Assign an agent/),
    })
    expect(() =>
      run('update', { status: 'in_progress', assignee: 5 }, { status: 'new', createdAt }),
    ).not.toThrow()
  })

  it('refuses clearing the assignee of a ticket that stays in progress', () => {
    const inProgress = { status: 'in_progress', assignee: 3, createdAt } as Data
    expect(failure(() => run('update', { assignee: null }, inProgress))).toMatchObject({
      path: 'assignee',
      message: expect.stringMatching(/Assign an agent/),
    })
    expect(() => run('update', { assignee: 4 }, inProgress)).not.toThrow()
  })

  it('lets any other status lose its assignee', () => {
    expect(() =>
      run('update', { assignee: null }, { status: 'waiting_customer', assignee: 3, createdAt }),
    ).not.toThrow()
  })
})

describe('beforeTicketChange on update: due date', () => {
  const ticket = {
    status: 'new',
    priority: 'low',
    createdAt,
    dueAt: '2026-11-08T10:00:00.000Z',
  } as Data

  it('moves the due date when the priority changes, counted from the creation time', () => {
    expect(run('update', { priority: 'urgent' }, ticket).dueAt).toBe('2026-11-01T14:00:00.000Z')
  })

  it('leaves the due date alone otherwise', () => {
    expect(run('update', { subject: 'Renamed' }, ticket).dueAt).toBeUndefined()
    expect(run('update', { priority: 'low' }, ticket).dueAt).toBeUndefined()
  })
})

describe('beforeTicketChange comments', () => {
  const mine = { id: 'c1', body: 'mine', author: 7, createdAt: '2026-01-01T00:00:00.000Z' }
  const theirs = { id: 'c2', body: 'theirs', author: 2, createdAt: '2026-01-02T00:00:00.000Z' }
  const ticket = { status: 'new', createdAt, comments: [mine, theirs] } as Data

  it('sets author and time on new comments from the server, ignoring what the client sent', () => {
    const data = run(
      'update',
      { comments: [{ body: 'hi', author: 99, createdAt: '2000-01-01' }] },
      {
        status: 'new',
        createdAt,
        comments: [],
      } as Data,
    )
    const [comment] = data.comments as { author: unknown; createdAt: string }[]
    expect(comment!.author).toBe(7)
    expect(comment!.createdAt).not.toBe('2000-01-01')
  })

  it('keeps author and time of existing comments the author edits', () => {
    const data = run(
      'update',
      { comments: [{ ...mine, body: 'edited', author: 99 }, theirs] },
      ticket,
    )
    const [comment] = data.comments as { body: string; author: unknown; createdAt: string }[]
    expect(comment).toMatchObject({
      body: 'edited',
      author: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it("refuses editing or removing someone else's comment", () => {
    expect(
      failure(() => run('update', { comments: [mine, { ...theirs, body: 'changed' }] }, ticket)),
    ).toEqual({
      path: 'comments',
      message: 'Only the author or an admin can edit a comment.',
    })
    expect(failure(() => run('update', { comments: [mine] }, ticket))).toEqual({
      path: 'comments',
      message: 'Only the author or an admin can remove a comment.',
    })
  })

  it('lets an admin edit and remove any comment, keeping the original author', () => {
    const data = run('update', { comments: [{ ...theirs, body: 'moderated' }] }, ticket, admin)
    expect(data.comments).toEqual([{ ...theirs, body: 'moderated' }])
  })

  it('keeps the author the seed sets when there is no user', () => {
    const data = run(
      'update',
      { comments: [{ body: 'seeded', author: 5 }] },
      { status: 'new', createdAt },
      null,
    )
    expect((data.comments as { author: unknown }[])[0]!.author).toBe(5)
  })
})
