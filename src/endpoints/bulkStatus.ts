import { ValidationError } from 'payload'
import type { PayloadHandler } from 'payload'

import { isStaff } from '../lib/access'
import { isTicketStatus } from '../lib/ticketStatus'

export const MAX_BULK_SIZE = 500

/**
 * POST /api/tickets/bulk-status  { ids: number[], status: TicketStatus }
 *
 * Each ticket is updated through the normal Payload update path with access
 * control on. The same status hook runs per ticket, so a bulk change follows the
 * same rules as a single change. One invalid ticket does not stop the others.
 */
export const bulkStatus: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isStaff({ req })) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json?.()
  } catch {
    return Response.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  const { ids, status } = (body ?? {}) as { ids?: unknown; status?: unknown }

  const idsValid =
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= MAX_BULK_SIZE &&
    ids.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)

  if (!idsValid) {
    return Response.json(
      { error: `ids must be 1 to ${MAX_BULK_SIZE} positive integers` },
      { status: 400 },
    )
  }
  if (!isTicketStatus(status)) {
    return Response.json({ error: 'status is not a valid ticket status' }, { status: 400 })
  }

  const updated: number[] = []
  const failed: { id: number; error: string }[] = []

  for (const id of ids as number[]) {
    try {
      await req.payload.update({
        collection: 'tickets',
        id,
        data: { status },
        req,
        overrideAccess: false,
      })
      updated.push(id)
    } catch (error) {
      failed.push({ id, error: describeError(error) })
    }
  }

  return Response.json({ updated: updated.length, failed })
}

function describeError(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.data.errors.map((item) => item.message).join('; ')
  }
  return 'Update failed'
}
