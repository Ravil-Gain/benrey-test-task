import { ValidationError } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createFixtures, type Fixtures } from './fixtures'

// The ticket rules on real writes: the hook and the field access run inside Payload's create
// and update operations, and the result is read back from the database.
let f: Fixtures

beforeAll(async () => {
  f = await createFixtures()
})

afterAll(async () => {
  await f?.cleanup()
})

const HOUR = 3600_000

async function newTicket(data: Record<string, unknown> = {}) {
  return f.payload.create({
    collection: 'tickets',
    data: {
      subject: 'Workflow check ticket',
      customer: f.customer,
      status: 'new' as const,
      priority: 'normal' as const,
      ...data,
    },
    user: f.agent as never,
    overrideAccess: false,
  })
}

function move(id: number | string, data: Record<string, unknown>, user: unknown = f.agent) {
  return f.payload.update({
    collection: 'tickets',
    id,
    data,
    user: user as never,
    overrideAccess: false,
  })
}

function stored(id: number | string) {
  return f.payload.findByID({ collection: 'tickets', id, overrideAccess: true, depth: 0 })
}

describe('creating a ticket', () => {
  it('starts as New with a due date from the priority', async () => {
    const before = Date.now()
    const ticket = await newTicket({ priority: 'urgent' })
    expect(ticket.status).toBe('new')
    const due = new Date(ticket.dueAt as string).getTime() - before
    expect(due).toBeGreaterThan(3.9 * HOUR)
    expect(due).toBeLessThan(4.1 * HOUR)
  })

  it('refuses any other start status and stores nothing', async () => {
    await expect(
      newTicket({ status: 'resolved', subject: 'Should not exist' }),
    ).rejects.toBeInstanceOf(ValidationError)
    const found = await f.payload.find({
      collection: 'tickets',
      where: {
        and: [{ customer: { equals: f.customer } }, { subject: { equals: 'Should not exist' } }],
      },
      overrideAccess: true,
    })
    expect(found.totalDocs).toBe(0)
  })

  it('ignores server-set dates sent by the client', async () => {
    const ticket = await newTicket({
      dueAt: '2000-01-01T00:00:00.000Z',
      resolvedAt: '2000-01-01T00:00:00.000Z',
      closedAt: '2000-01-01T00:00:00.000Z',
    })
    expect(new Date(ticket.dueAt as string).getFullYear()).toBeGreaterThan(2000)
    expect(ticket.resolvedAt).toBeNull()
    expect(ticket.closedAt).toBeNull()
  })
})

describe('moving a ticket', () => {
  it('needs an assignee for In progress, then follows the map and stamps the times', async () => {
    const ticket = await newTicket()
    await expect(move(ticket.id, { status: 'in_progress' })).rejects.toBeInstanceOf(ValidationError)

    const started = await move(ticket.id, { status: 'in_progress', assignee: f.agent.id })
    expect(started.status).toBe('in_progress')

    await expect(move(ticket.id, { status: 'new' })).rejects.toBeInstanceOf(ValidationError)
    await expect(move(ticket.id, { assignee: null })).rejects.toBeInstanceOf(ValidationError)

    const resolved = await move(ticket.id, { status: 'resolved' })
    expect(resolved.resolvedAt).toBeTruthy()

    const reopened = await move(ticket.id, { status: 'in_progress' })
    expect(reopened.resolvedAt).toBeNull()

    await move(ticket.id, { status: 'resolved' })
    const closed = await move(ticket.id, { status: 'closed' })
    expect(closed.closedAt).toBeTruthy()
    expect(closed.resolvedAt).toBeTruthy()

    await expect(move(ticket.id, { status: 'in_progress' })).rejects.toBeInstanceOf(ValidationError)
    expect((await stored(ticket.id)).status).toBe('closed')
  })

  it('only accepts an agent as assignee', async () => {
    const ticket = await newTicket()
    await expect(move(ticket.id, { assignee: f.admin.id })).rejects.toBeInstanceOf(ValidationError)
    await expect(move(ticket.id, { assignee: f.noRole.id })).rejects.toBeInstanceOf(ValidationError)
    await move(ticket.id, { assignee: f.agent.id })
    expect((await stored(ticket.id)).assignee).toBe(f.agent.id)
  })

  it('keeps the due date when an agent sends one, and moves it when the priority changes', async () => {
    const ticket = await newTicket({ priority: 'low' })
    const created = new Date(ticket.createdAt).getTime()

    const tampered = await move(ticket.id, { dueAt: '2000-01-01T00:00:00.000Z' })
    expect(tampered.dueAt).toBe(ticket.dueAt)

    const escalated = await move(ticket.id, { priority: 'urgent' })
    expect(new Date(escalated.dueAt as string).getTime()).toBe(created + 4 * HOUR)
  })

  it('works out Is Overdue when the ticket is read', async () => {
    const ticket = await newTicket()
    await f.payload.update({
      collection: 'tickets',
      id: ticket.id,
      data: { dueAt: new Date(Date.now() - HOUR).toISOString() },
      overrideAccess: true,
    })
    expect((await stored(ticket.id)).isOverdue).toBe(true)
  })
})

describe('comments', () => {
  it('takes the author from the logged-in user, and only the author or an admin can change it', async () => {
    const ticket = await newTicket()
    const withComment = await move(ticket.id, {
      comments: [{ body: 'First reply', author: f.admin.id }],
    })
    const [comment] = withComment.comments ?? []
    const author = typeof comment?.author === 'object' ? comment.author?.id : comment?.author
    expect(author).toBe(f.agent.id)
    expect(comment?.createdAt).toBeTruthy()

    const edited = { id: comment!.id, body: 'Edited by someone else' }
    await expect(move(ticket.id, { comments: [edited] }, f.noRole)).rejects.toThrow()
    const second = { ...f.agent, id: f.secondAgent.id }
    await expect(move(ticket.id, { comments: [edited] }, second)).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(move(ticket.id, { comments: [] }, second)).rejects.toBeInstanceOf(ValidationError)

    const moderated = await move(ticket.id, { comments: [edited] }, f.admin)
    expect(moderated.comments?.[0]).toMatchObject({ body: 'Edited by someone else' })
    const keptAuthor = moderated.comments?.[0]?.author
    expect(typeof keptAuthor === 'object' ? keptAuthor?.id : keptAuthor).toBe(f.agent.id)
  })

  it('does not copy comments when a ticket is duplicated, and the copy starts over', async () => {
    const ticket = await newTicket()
    await move(ticket.id, { comments: [{ body: 'Original conversation' }], status: 'closed' })

    const copy = await f.payload.duplicate({
      collection: 'tickets',
      id: ticket.id,
      user: f.agent as never,
      overrideAccess: false,
    })
    expect(copy.status).toBe('new')
    expect(copy.comments ?? []).toEqual([])
    expect(copy.closedAt).toBeNull()
    expect(copy.dueAt).not.toBe(ticket.dueAt)
  })
})

describe('finding tickets', () => {
  it('matches the customer name and email through the relation, as the list search does', async () => {
    await newTicket({ subject: 'Search by customer check' })
    for (const field of ['customer.name', 'customer.email']) {
      const found = await f.payload.find({
        collection: 'tickets',
        where: {
          and: [{ [field]: { like: f.run } }, { subject: { equals: 'Search by customer check' } }],
        },
        overrideAccess: true,
      })
      expect(found.totalDocs).toBe(1)
    }
  })
})
