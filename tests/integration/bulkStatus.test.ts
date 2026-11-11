import { createLocalReq } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bulkStatus } from '../../src/endpoints/bulkStatus'
import { createFixtures, type Fixtures } from './fixtures'

// The bulk status endpoint with a real request object and a real database: the same handler
// Payload mounts at POST /api/tickets/bulk-status.
let f: Fixtures

beforeAll(async () => {
  f = await createFixtures()
})

afterAll(async () => {
  await f?.cleanup()
})

async function call(user: unknown, body: unknown) {
  const req = await createLocalReq({ user: user as never }, f.payload)
  req.json = async () => body
  const response = await bulkStatus(req)
  return { status: response.status, body: (await response.json()) as { updated?: number; failed?: { id: number; error: string }[] } }
}

async function ticket(data: Record<string, unknown>) {
  const created = await f.payload.create({
    collection: 'tickets',
    overrideAccess: true,
    data: { subject: 'Bulk check ticket', customer: f.customer, status: 'new', priority: 'normal', ...data },
  })
  return created.id as number
}

describe('POST /api/tickets/bulk-status', () => {
  it('moves the tickets the workflow allows and reports the rest, per ticket', async () => {
    const assigned = await ticket({ assignee: f.agent.id })
    const unassigned = await ticket({})
    const closed = await ticket({})
    await f.payload.update({ collection: 'tickets', id: closed, data: { status: 'closed' }, overrideAccess: true })

    const { status, body } = await call(f.agent, { ids: [assigned, unassigned, closed], status: 'in_progress' })

    expect(status).toBe(200)
    expect(body.updated).toBe(1)
    expect(body.failed).toEqual([
      { id: unassigned, error: 'Assign an agent before moving the ticket to "In progress".' },
      { id: closed, error: 'Cannot change status from "Closed" to "In progress".' },
    ])
    const stored = await f.payload.find({
      collection: 'tickets',
      where: { id: { in: [assigned, unassigned, closed] } },
      overrideAccess: true,
      sort: 'id',
    })
    expect(stored.docs.map((doc) => doc.status)).toEqual(['in_progress', 'new', 'closed'])
  })

  it('refuses a caller without a staff role and changes nothing', async () => {
    const id = await ticket({ assignee: f.agent.id })
    expect((await call(f.noRole, { ids: [id], status: 'in_progress' })).status).toBe(403)
    expect((await call(null, { ids: [id], status: 'in_progress' })).status).toBe(401)
    const stored = await f.payload.findByID({ collection: 'tickets', id, overrideAccess: true })
    expect(stored.status).toBe('new')
  })

  it('reports an id that does not exist instead of failing the batch', async () => {
    const id = await ticket({ assignee: f.agent.id })
    const { body } = await call(f.admin, { ids: [id, 999_999_999], status: 'in_progress' })
    expect(body.updated).toBe(1)
    expect(body.failed).toEqual([{ id: 999_999_999, error: 'Update failed' }])
  })
})
