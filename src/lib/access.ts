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

// Who may create a user account: an admin, through any API, or the server's own code
// through the local API (the seed). Payload's first-user registration
// (POST /api/users/first-register) runs with overrideAccess, so it skips the `create`
// access function. The users hook calls this too, which closes that path: without it,
// anyone could create the first user with the admin role while the table is empty.
export function mayCreateUser(req: { user?: unknown; payloadAPI?: string }): boolean {
  return req.payloadAPI === 'local' || hasRole(req.user, 'admin')
}

// Admins and agents. Anyone with a staff role can work on tickets.
export const isStaff = ({ req }: RequestLike): boolean =>
  hasRole(req.user, 'admin') || hasRole(req.user, 'agent')
