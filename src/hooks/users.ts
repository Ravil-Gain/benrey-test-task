import { Forbidden } from 'payload'
import type { CollectionBeforeOperationHook } from 'payload'

import { mayCreateUser } from '../lib/access'

// Runs even when access checks are skipped (overrideAccess), which is how Payload's
// first-user registration creates its user. The first admin comes from `pnpm seed`.
export const beforeUserOperation: CollectionBeforeOperationHook = ({ operation, req }) => {
  if (operation === 'create' && !mayCreateUser(req)) {
    throw new Forbidden(req.t)
  }
}
