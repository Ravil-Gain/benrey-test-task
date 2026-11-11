// Role checks for the collection access functions. Roles live on users.roles.

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

export const isStaff = ({ req }: RequestLike): boolean =>
  hasRole(req.user, 'admin') || hasRole(req.user, 'agent')

// Admins may update any user. Everyone else only their own account (name, email, password).
export const isAdminOrSelf = ({ req }: RequestLike): boolean | { id: { equals: unknown } } => {
  if (isAdmin({ req })) {
    return true
  }
  const id = (req.user as { id?: unknown } | undefined)?.id
  return id === undefined ? false : { id: { equals: id } }
}

// Who may create a user: an admin, or server code through the local API (the seed). Payload's
// first-user registration skips `access`, so the users hook calls this as well.
export function mayCreateUser(req: { user?: unknown; payloadAPI?: string }): boolean {
  return req.payloadAPI === 'local' || hasRole(req.user, 'admin')
}
