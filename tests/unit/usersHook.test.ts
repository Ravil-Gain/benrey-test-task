import { Forbidden, ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'

import { beforeUserChange, beforeUserOperation } from '../../src/hooks/users'
import { mayCreateUser } from '../../src/lib/access'

const admin = { id: 1, roles: ['admin'] }
const agent = { id: 2, roles: ['agent'] }

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

type OperationArgs = Parameters<typeof beforeUserOperation>[0]

function operation(name: string, req: { user?: unknown; payloadAPI?: string }) {
  return () =>
    beforeUserOperation({
      operation: name,
      req: { ...req, t: (key: string) => key },
    } as unknown as OperationArgs)
}

describe('beforeUserOperation', () => {
  it('blocks the public first-user registration, which runs with overrideAccess', () => {
    expect(operation('create', { user: null, payloadAPI: 'REST' })).toThrow(Forbidden)
  })

  it('blocks an agent creating a user, and allows an admin and the seed', () => {
    expect(operation('create', { user: agent, payloadAPI: 'REST' })).toThrow(Forbidden)
    expect(operation('create', { user: admin, payloadAPI: 'REST' })).not.toThrow()
    expect(operation('create', { user: null, payloadAPI: 'local' })).not.toThrow()
  })

  it('leaves other operations to the access functions', () => {
    expect(operation('read', { user: null, payloadAPI: 'REST' })).not.toThrow()
    expect(operation('login', { user: null, payloadAPI: 'REST' })).not.toThrow()
    expect(operation('update', { user: agent, payloadAPI: 'REST' })).not.toThrow()
  })
})

type ChangeArgs = Parameters<typeof beforeUserChange>[0]

function change(
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown>,
  user: unknown,
) {
  return () =>
    beforeUserChange({
      data,
      originalDoc,
      operation: 'update',
      req: { user, t: (key: string) => key },
    } as unknown as ChangeArgs)
}

describe('beforeUserChange', () => {
  it('refuses an admin removing the admin role from their own account', () => {
    expect(change({ roles: ['agent'] }, admin, admin)).toThrow(ValidationError)
    expect(change({ roles: [] }, admin, admin)).toThrow(ValidationError)
  })

  it('lets an admin keep the role, change other fields, or change another admin', () => {
    expect(change({ roles: ['admin', 'agent'] }, admin, admin)).not.toThrow()
    expect(change({ name: 'New name' }, admin, admin)).not.toThrow()
    expect(change({ roles: ['agent'] }, { id: 3, roles: ['admin'] }, admin)).not.toThrow()
  })

  it('does not apply to users who are not admins', () => {
    expect(change({ roles: [] }, agent, agent)).not.toThrow()
  })
})
