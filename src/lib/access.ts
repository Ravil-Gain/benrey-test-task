/**
 * Role helpers used by collection access functions.
 *
 * Roles are stored on the `users` collection as a `roles` array. These helpers
 * accept `unknown` so they can be called with whatever `req.user` Payload gives.
 */

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

/** Admins and agents. Anyone with a staff role can work on tickets. */
export const isStaff = ({ req }: RequestLike): boolean =>
  hasRole(req.user, 'admin') || hasRole(req.user, 'agent')
