import { describe, expect, it } from 'vitest'

import { hasRole, isAdmin, isStaff } from '../../src/lib/access'

const admin = { roles: ['admin'] }
const agent = { roles: ['agent'] }
const both = { roles: ['admin', 'agent'] }

describe('hasRole', () => {
  it('matches a role listed in roles', () => {
    expect(hasRole(agent, 'agent')).toBe(true)
    expect(hasRole(agent, 'admin')).toBe(false)
  })

  it('returns false for anonymous or malformed users', () => {
    expect(hasRole(null, 'agent')).toBe(false)
    expect(hasRole(undefined, 'agent')).toBe(false)
    expect(hasRole({ roles: 'agent' }, 'agent')).toBe(false)
    expect(hasRole({}, 'agent')).toBe(false)
    expect(hasRole('agent', 'agent')).toBe(false)
  })
})

describe('isAdmin', () => {
  it('allows admins only', () => {
    expect(isAdmin({ req: { user: admin } })).toBe(true)
    expect(isAdmin({ req: { user: agent } })).toBe(false)
    expect(isAdmin({ req: { user: undefined } })).toBe(false)
  })
})

describe('isStaff', () => {
  it('allows admins and agents', () => {
    expect(isStaff({ req: { user: admin } })).toBe(true)
    expect(isStaff({ req: { user: agent } })).toBe(true)
    expect(isStaff({ req: { user: both } })).toBe(true)
  })

  it('rejects anonymous requests', () => {
    expect(isStaff({ req: { user: null } })).toBe(false)
    expect(isStaff({ req: {} })).toBe(false)
  })
})
