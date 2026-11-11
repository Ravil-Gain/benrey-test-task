import { randomUUID } from 'crypto'
import { getPayload, type Payload } from 'payload'

import config from '../../src/payload.config'

type User = { id: number; roles: string[]; collection: 'users' }

export type Fixtures = {
  payload: Payload
  run: string
  admin: User
  agent: User
  secondAgent: User
  noRole: User
  customer: number
  cleanup: () => Promise<void>
}

// One admin, two agents, one user without a role and one customer, each with a unique email
// that contains `run`, created through the local API like the seed. cleanup() deletes them and
// every ticket that points at the customer.
export async function createFixtures(): Promise<Fixtures> {
  const payload = await getPayload({ config })
  const run = randomUUID().slice(0, 8)
  const password = `it-${randomUUID()}`

  const user = async (role: string | null, suffix = ''): Promise<User> => {
    const doc = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        email: `it-${role ?? 'none'}${suffix}-${run}@example.test`,
        name: `Integration ${role ?? 'no role'}${suffix}`,
        password,
        roles: role ? [role as 'admin' | 'agent'] : [],
      },
    })
    return { id: doc.id as number, roles: (doc.roles ?? []) as string[], collection: 'users' }
  }

  const admin = await user('admin')
  const agent = await user('agent')
  const secondAgent = await user('agent', '2')
  const noRole = await user(null)
  const customer = await payload.create({
    collection: 'customers',
    overrideAccess: true,
    data: { name: `Integration ${run}`, email: `it-customer-${run}@example.test` },
  })

  return {
    payload,
    run,
    admin,
    agent,
    secondAgent,
    noRole,
    customer: customer.id as number,
    async cleanup() {
      await payload.delete({
        collection: 'tickets',
        where: { customer: { equals: customer.id } },
        overrideAccess: true,
      })
      await payload.delete({ collection: 'customers', id: customer.id, overrideAccess: true })
      for (const id of [admin.id, agent.id, secondAgent.id, noRole.id]) {
        await payload.delete({ collection: 'users', id, overrideAccess: true })
      }
    },
  }
}
