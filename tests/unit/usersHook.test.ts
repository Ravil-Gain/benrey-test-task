import { Forbidden } from 'payload'
import { describe, expect, it } from 'vitest'

import { beforeUserOperation } from '../../src/hooks/users'
import { mayCreateUser } from '../../src/lib/access'

const admin = { roles: ['admin'] }
const agent = { roles: ['agent'] }

describe('mayCreateUser', () => {
  it('lets an admin create users through any API', () => {
    expect(mayCreateUser({ user: admin, payloadAPI: 'REST' })).toBe(true)
    expect(mayCreateUser({ user: admin, payloadAPI: 'GraphQL' })).toBe(true)
  })

  it('lets server code create users through the local API (the seed)', () => {
    expect(mayCreateUser({ user: null, payloadAPI: 'local' })).toBe(true)
  })

  it('refuses anonymous, role-less and agent callers over HTTP', () => {
    expect(mayCreateUser({ user: null, payloadAPI: 'REST' })).toBe(false)
    expect(mayCreateUser({ user: { roles: [] }, payloadAPI: 'REST' })).toBe(false)
    expect(mayCreateUser({ user: agent, payloadAPI: 'REST' })).toBe(false)
    expect(mayCreateUser({ user: undefined, payloadAPI: undefined })).toBe(false)
  })
})

type HookArgs = Parameters<typeof beforeUserOperation>[0]

function run(operation: string, req: { user?: unknown; payloadAPI?: string }) {
  return () =>
    beforeUserOperation({ operation, req: { ...req, t: (key: string) => key } } as unknown as HookArgs)
}

describe('beforeUserOperation', () => {
  it('blocks the public first-user registration, which runs with overrideAccess', () => {
    // POST /api/users/first-register: REST, nobody logged in, roles sent by the caller.
    expect(run('create', { user: null, payloadAPI: 'REST' })).toThrow(Forbidden)
  })

  it('blocks an agent creating a user', () => {
    expect(run('create', { user: agent, payloadAPI: 'REST' })).toThrow(Forbidden)
  })

  it('allows an admin and the seed', () => {
    expect(run('create', { user: admin, payloadAPI: 'REST' })).not.toThrow()
    expect(run('create', { user: null, payloadAPI: 'local' })).not.toThrow()
  })

  it('leaves other operations to the access functions', () => {
    expect(run('read', { user: null, payloadAPI: 'REST' })).not.toThrow()
    expect(run('login', { user: null, payloadAPI: 'REST' })).not.toThrow()
    expect(run('update', { user: agent, payloadAPI: 'REST' })).not.toThrow()
  })
})
