import { Forbidden, NotFound, ValidationError } from 'payload'
import type { PayloadHandler } from 'payload'

import { isStaff } from '../lib/access'
import { MAX_BULK_SIZE } from '../lib/bulkStatusBatches'
import { isTicketStatus } from '../lib/ticketStatus'

// POST /api/tickets/bulk-status  { ids: number[], status: TicketStatus }
//
// Each ticket goes through payload.update with access control on, so the workflow hook runs
// for every one. A refused ticket lands in `failed` and the rest still update.
export const bulkStatus: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isStaff({ req })) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { ids?: unknown; status?: unknown }
  try {
    body = (await req.json?.()) ?? {}
  } catch {
    return Response.json({ error: 'Request body must be JSON' }, { status: 400 })
  }
  const { ids, status } = body

  if (!isIdList(ids)) {
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

  for (const id of ids) {
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

function isIdList(ids: unknown): ids is number[] {
  return (
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= MAX_BULK_SIZE &&
    ids.every((id) => Number.isInteger(id) && id > 0)
  )
}

// The reason per ticket. Anything unexpected stays generic, so internals never reach the client.
function describeError(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.data.errors.map((item) => item.message).join('; ')
  }
  if (error instanceof NotFound) {
    return 'Ticket not found'
  }
  if (error instanceof Forbidden) {
    return 'Not allowed'
  }
  return 'Update failed'
}
