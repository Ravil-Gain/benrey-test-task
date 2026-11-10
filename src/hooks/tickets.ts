import { ValidationError } from 'payload'
import type { CollectionBeforeChangeHook } from 'payload'

import type { Ticket } from '../payload-types'
import { computeDueAt, type TicketPriority } from '../lib/dueDate'
import { validateStatusChange, type TicketStatus } from '../lib/ticketStatus'

type CommentRow = NonNullable<Ticket['comments']>[number]

// The ticket rules. This runs on every write (admin, REST, local API, bulk endpoint),
// so it does not matter where a change comes from.
export const beforeTicketChange: CollectionBeforeChangeHook<Ticket> = ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const now = new Date()
  const nowIso = now.toISOString()
  const status = data.status as TicketStatus | undefined

  if (operation === 'create') {
    const priority = (data.priority ?? 'normal') as TicketPriority
    data.dueAt = computeDueAt(priority, now).toISOString()
  }

  if (operation === 'update' && originalDoc && status && status !== originalDoc.status) {
    const hasAssignee = 'assignee' in data ? Boolean(data.assignee) : Boolean(originalDoc.assignee)
    const error = validateStatusChange({
      from: originalDoc.status as TicketStatus,
      to: status,
      hasAssignee,
    })
    if (error) {
      throw new ValidationError({
        collection: 'tickets',
        errors: [{ message: error, path: 'status' }],
        req,
      })
    }
  }

  // Stamp the time when a ticket enters resolved or closed. New tickets can start in
  // either status, so create counts too.
  const enteredStatus = operation === 'create' || (status && status !== originalDoc?.status)
  if (enteredStatus && status === 'resolved') {
    data.resolvedAt = nowIso
  }
  if (enteredStatus && status === 'closed') {
    data.closedAt = nowIso
  }

  // Comment authors and times come from the server, not the client.
  // Rows that already exist keep their original author and time.
  if (Array.isArray(data.comments)) {
    const existing = new Map<string, CommentRow>()
    for (const row of originalDoc?.comments ?? []) {
      if (row.id) {
        existing.set(row.id, row)
      }
    }
    data.comments = data.comments.map((row) => {
      const old = row.id ? existing.get(row.id) : undefined
      return {
        ...row,
        author: old?.author ?? req.user?.id ?? row.author,
        createdAt: old?.createdAt ?? nowIso,
      }
    })
  }

  return data
}
