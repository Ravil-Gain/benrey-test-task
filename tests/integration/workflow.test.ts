import { ValidationError } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createFixtures, type Fixtures } from './fixtures'

// The ticket workflow on real writes: the hook runs inside Payload's create and update
// operations and the result is read back from the database.
let f: Fixtures

beforeAll(async () => {
  f = await createFixtures()
})

afterAll(async () => {
  await f?.cleanup()
})

async function newTicket(data: Record<string, unknown> = {}) {
  return f.payload.create({
    collection: 'tickets',
    data: { subject: 'Workflow check ticket', customer: f.customer, status: 'new' as const, priority: 'normal' as const, ...data },
    user: f.agent as never,
    overrideAccess: false,
  })
}

function move(id: number | string, data: Record<string, unknown>) {
  return f.payload.update({ collection: 'tickets', id, data, user: f.agent as never, overrideAccess: false })
}

describe('creating a ticket', () => {
  it('starts as New with a due date from the priority', async () => {
    const before = Date.now()
    const ticket = await newTicket({ priority: 'urgent' })
    expect(ticket.status).toBe('new')
    const due = new Date(ticket.dueAt as string).getTime() - before
    expect(due).toBeGreaterThan(3.9 * 3600_000)
    expect(due).toBeLessThan(4.1 * 3600_000)
  })

  it('refuses any other start status and stores nothing', async () => {
    await expect(newTicket({ status: 'resolved', subject: 'Should not exist' })).rejects.toBeInstanceOf(ValidationError)
    const found = await f.payload.find({
      collection: 'tickets',
      where: { and: [{ customer: { equals: f.customer } }, { subject: { equals: 'Should not exist' } }] },
      overrideAccess: true,
    })
    expect(found.totalDocs).toBe(0)
  })
})

describe('moving a ticket', () => {
  it('needs an assignee for In progress, then follows the map and stamps the times', async () => {
    const ticket = await newTicket()
    await expect(move(ticket.id, { status: 'in_progress' })).rejects.toBeInstanceOf(ValidationError)

    const started = await move(ticket.id, { status: 'in_progress', assignee: f.agent.id })
    expect(started.status).toBe('in_progress')

    await expect(move(ticket.id, { status: 'new' })).rejects.toBeInstanceOf(ValidationError)

    const resolved = await move(ticket.id, { status: 'resolved' })
    expect(resolved.resolvedAt).toBeTruthy()

    const closed = await move(ticket.id, { status: 'closed' })
    expect(closed.closedAt).toBeTruthy()

    await expect(move(ticket.id, { status: 'in_progress' })).rejects.toBeInstanceOf(ValidationError)
    const stored = await f.payload.findByID({ collection: 'tickets', id: ticket.id, overrideAccess: true })
    expect(stored.status).toBe('closed')
  })

  it('works out Is Overdue when the ticket is read', async () => {
    const ticket = await newTicket()
    await f.payload.update({
      collection: 'tickets',
      id: ticket.id,
      data: { dueAt: new Date(Date.now() - 3600_000).toISOString() },
      overrideAccess: true,
    })
    const read = await f.payload.findByID({ collection: 'tickets', id: ticket.id, overrideAccess: true })
    expect(read.isOverdue).toBe(true)
  })
})

describe('comments', () => {
  it('takes the author from the logged-in user, not from the data sent', async () => {
    const ticket = await newTicket()
    const updated = await move(ticket.id, { comments: [{ body: 'First reply', author: f.admin.id }] })
    const [comment] = updated.comments ?? []
    const author = typeof comment?.author === 'object' ? comment.author?.id : comment?.author
    expect(author).toBe(f.agent.id)
    expect(comment?.createdAt).toBeTruthy()
  })
})
