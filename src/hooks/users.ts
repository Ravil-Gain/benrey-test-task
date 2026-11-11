import { Forbidden, ValidationError } from 'payload'
import type { CollectionBeforeChangeHook, CollectionBeforeOperationHook } from 'payload'

import { hasRole, mayCreateUser } from '../lib/access'

// Runs even when access checks are skipped (overrideAccess), which is how Payload's
// first-user registration creates its user. The first admin comes from `pnpm seed`.
export const beforeUserOperation: CollectionBeforeOperationHook = ({ operation, req }) => {
  if (operation === 'create' && !mayCreateUser(req)) {
    throw new Forbidden(req.t)
  }
}

// An admin cannot take the admin role away from their own account. Otherwise the last
// admin could lock everyone out, with only the database left to undo it.
export const beforeUserChange: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (
    operation === 'update' &&
    originalDoc &&
    req.user?.id === originalDoc.id &&
    hasRole(originalDoc, 'admin') &&
    Array.isArray(data.roles) &&
    !data.roles.includes('admin')
  ) {
    throw new ValidationError({
      collection: 'users',
      errors: [{ message: 'You cannot remove your own admin role.', path: 'roles' }],
      req,
    })
  }
  return data
}
