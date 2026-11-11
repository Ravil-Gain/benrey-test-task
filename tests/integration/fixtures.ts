import { randomUUID } from 'crypto'
import { getPayload, type Payload } from 'payload'

import config from '../../src/payload.config'

export type Fixtures = {
  payload: Payload
  admin: { id: number; roles: string[]; collection: 'users' }
  agent: { id: number; roles: string[]; collection: 'users' }
  noRole: { id: number; roles: string[]; collection: 'users' }
  customer: number
  cleanup: () => Promise<void>
}

// Creates one admin, one agent, one user without a role and one customer, each with a unique
// email, through the local API (like the seed). cleanup() deletes them and every ticket that
// points at the customer, so test runs do not pile up rows.
export async function createFixtures(): Promise<Fixtures> {
  const payload = await getPayload({ config })
  const run = randomUUID().slice(0, 8)
  const password = `it-${randomUUID()}`

  const user = async (role: string | null) => {
    const doc = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        email: `it-${role ?? 'none'}-${run}@example.test`,
        name: `Integration ${role ?? 'no role'}`,
        password,
        roles: role ? [role as 'admin' | 'agent'] : [],
      },
    })
    return { id: doc.id as number, roles: (doc.roles ?? []) as string[], collection: 'users' as const }
  }

  const admin = await user('admin')
  const agent = await user('agent')
  const noRole = await user(null)
  const customer = await payload.create({
    collection: 'customers',
    overrideAccess: true,
    data: { name: `Integration ${run}`, email: `it-customer-${run}@example.test` },
  })

  return {
    payload,
    admin,
    agent,
    noRole,
    customer: customer.id as number,
    async cleanup() {
      await payload.delete({ collection: 'tickets', where: { customer: { equals: customer.id } }, overrideAccess: true })
      await payload.delete({ collection: 'customers', id: customer.id, overrideAccess: true })
      for (const id of [admin.id, agent.id, noRole.id]) {
        await payload.delete({ collection: 'users', id, overrideAccess: true })
      }
    },
  }
}
