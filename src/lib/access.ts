// Role checks for collection access functions.
// Roles live on users.roles. These take `unknown` because req.user can be anything.

export type Role = 'admin' | 'agent'

export function hasRole(user: unknown, role: Role): boolean {
  if (typeof user !== 'object' || user === null || !('roles' in user)) {
    return false
  }
  const roles = (user as { roles: unknown }).roles
  return Array.isArray(roles) && roles.includes(role)
}

type RequestLike = { req: { user?: unknown } }

export const isAdmin = ({ req }: RequestLike): boolean => hasRole(req.user, 'admin')

// Admins and agents. Anyone with a staff role can work on tickets.
export const isStaff = ({ req }: RequestLike): boolean =>
  hasRole(req.user, 'admin') || hasRole(req.user, 'agent')
