import { describe, expect, it } from 'vitest'

import { hasRole, isAdmin, isAdminOrSelf, isStaff } from '../../src/lib/access'

const admin = { id: 1, roles: ['admin'] }
const agent = { id: 2, roles: ['agent'] }
const both = { id: 3, roles: ['admin', 'agent'] }

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

describe('isAdmin and isStaff', () => {
  it('isAdmin allows admins only', () => {
    expect(isAdmin({ req: { user: admin } })).toBe(true)
    expect(isAdmin({ req: { user: agent } })).toBe(false)
    expect(isAdmin({ req: { user: undefined } })).toBe(false)
  })

  it('isStaff allows admins and agents, not anonymous requests', () => {
    expect(isStaff({ req: { user: admin } })).toBe(true)
    expect(isStaff({ req: { user: agent } })).toBe(true)
    expect(isStaff({ req: { user: both } })).toBe(true)
    expect(isStaff({ req: { user: null } })).toBe(false)
    expect(isStaff({ req: {} })).toBe(false)
  })
})

describe('isAdminOrSelf', () => {
  it('lets an admin update anyone', () => {
    expect(isAdminOrSelf({ req: { user: admin } })).toBe(true)
  })

  it('limits everyone else to their own account, as a query on the id', () => {
    expect(isAdminOrSelf({ req: { user: agent } })).toEqual({ id: { equals: 2 } })
    expect(isAdminOrSelf({ req: { user: { id: 9, roles: [] } } })).toEqual({ id: { equals: 9 } })
  })

  it('refuses anonymous requests', () => {
    expect(isAdminOrSelf({ req: { user: null } })).toBe(false)
    expect(isAdminOrSelf({ req: {} })).toBe(false)
  })
})
