import { Forbidden } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createFixtures, type Fixtures } from './fixtures'

// The access rules on a real database, through Payload's local API with access control on
// (overrideAccess: false), which is what the REST API and the admin use too.
let f: Fixtures
let ticketId: number

beforeAll(async () => {
  f = await createFixtures()
  const ticket = await f.payload.create({
    collection: 'tickets',
    overrideAccess: true,
    data: { subject: 'Access check ticket', customer: f.customer, status: 'new', priority: 'normal' },
  })
  ticketId = ticket.id as number
})

afterAll(async () => {
  await f?.cleanup()
})

const as = (user: unknown) => ({ user: user as never, overrideAccess: false })

describe('tickets', () => {
  it('admin and agent can read, a user without a role and an anonymous caller cannot', async () => {
    expect((await f.payload.findByID({ collection: 'tickets', id: ticketId, ...as(f.admin) })).id).toBe(ticketId)
    expect((await f.payload.findByID({ collection: 'tickets', id: ticketId, ...as(f.agent) })).id).toBe(ticketId)
    await expect(f.payload.find({ collection: 'tickets', ...as(f.noRole) })).rejects.toBeInstanceOf(Forbidden)
    await expect(f.payload.find({ collection: 'tickets', ...as(null) })).rejects.toBeInstanceOf(Forbidden)
  })

  it('an agent cannot delete a ticket, an admin can', async () => {
    await expect(f.payload.delete({ collection: 'tickets', id: ticketId, ...as(f.agent) })).rejects.toBeInstanceOf(
      Forbidden,
    )
    const spare = await f.payload.create({
      collection: 'tickets',
      data: { subject: 'Ticket the admin deletes', customer: f.customer, status: 'new', priority: 'normal' },
      ...as(f.agent),
    })
    await f.payload.delete({ collection: 'tickets', id: spare.id, ...as(f.admin) })
    await expect(f.payload.findByID({ collection: 'tickets', id: spare.id, overrideAccess: true })).rejects.toThrow()
  })
})

describe('users', () => {
  it('an agent cannot create a user or give itself the admin role', async () => {
    await expect(
      f.payload.create({
        collection: 'users',
        data: { email: `it-intruder-${ticketId}@example.test`, name: 'x', password: 'x'.repeat(16), roles: ['admin'] },
        ...as(f.agent),
      }),
    ).rejects.toBeInstanceOf(Forbidden)
    await expect(
      f.payload.update({ collection: 'users', id: f.agent.id, data: { roles: ['admin', 'agent'] }, ...as(f.agent) }),
    ).rejects.toBeInstanceOf(Forbidden)
    const stored = await f.payload.findByID({ collection: 'users', id: f.agent.id, overrideAccess: true })
    expect(stored.roles).toEqual(['agent'])
  })

  it('refuses a REST create without an admin even when access checks are skipped (first-register)', async () => {
    await expect(
      f.payload.create({
        collection: 'users',
        overrideAccess: true,
        data: { email: `it-first-${ticketId}@example.test`, name: 'x', password: 'x'.repeat(16), roles: ['admin'] },
        req: { payloadAPI: 'REST', user: null } as never,
      }),
    ).rejects.toBeInstanceOf(Forbidden)
    const found = await f.payload.find({
      collection: 'users',
      where: { email: { equals: `it-first-${ticketId}@example.test` } },
      overrideAccess: true,
    })
    expect(found.totalDocs).toBe(0)
  })
})

describe('tags and media', () => {
  it('an agent can read tags but not create them', async () => {
    await expect(f.payload.find({ collection: 'tags', limit: 1, ...as(f.agent) })).resolves.toBeDefined()
    await expect(
      f.payload.create({ collection: 'tags', data: { name: `it-tag-${ticketId}` }, ...as(f.agent) }),
    ).rejects.toBeInstanceOf(Forbidden)
  })
})
