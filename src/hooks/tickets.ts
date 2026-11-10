import { ValidationError } from 'payload'
import type { CollectionBeforeChangeHook } from 'payload'

import type { Ticket } from '../payload-types'
import { computeDueAt, type TicketPriority } from '../lib/dueDate'
import { validateStatusChange, type TicketStatus } from '../lib/ticketStatus'

type CommentRow = NonNullable<Ticket['comments']>[number]

/**
 * Business rules for tickets. Runs on every write path (admin, REST, local API,
 * bulk endpoint), so the rules cannot be bypassed from the UI.
 */
export const beforeTicketChange: CollectionBeforeChangeHook<Ticket> = ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const now = new Date()

  if (operation === 'create') {
    const priority = (data.priority ?? 'normal') as TicketPriority
    data.dueAt = computeDueAt(priority, now).toISOString()
    if (data.status === 'resolved') {
      data.resolvedAt = now.toISOString()
    }
    if (data.status === 'closed') {
      data.closedAt = now.toISOString()
    }
  }

  if (operation === 'update' && originalDoc && data.status && data.status !== originalDoc.status) {
    const hasAssignee =
      'assignee' in data ? Boolean(data.assignee) : Boolean(originalDoc.assignee)

    const error = validateStatusChange({
      from: originalDoc.status as TicketStatus,
      to: data.status as TicketStatus,
      hasAssignee,
    })
    if (error) {
      throw new ValidationError({
        collection: 'tickets',
        errors: [{ message: error, path: 'status' }],
        req,
      })
    }

    if (data.status === 'resolved') {
      data.resolvedAt = now.toISOString()
    }
    if (data.status === 'closed') {
      data.closedAt = now.toISOString()
    }
  }

  // Comment authorship and timestamps come from the server, never from the client.
  // Existing rows keep their original author; new rows get the current user.
  if (Array.isArray(data.comments)) {
    const previousRows = new Map<string, CommentRow>()
    for (const row of originalDoc?.comments ?? []) {
      if (row.id) {
        previousRows.set(row.id, row)
      }
    }
    data.comments = data.comments.map((row) => {
      const previous = row.id ? previousRows.get(row.id) : undefined
      return {
        ...row,
        author: previous?.author ?? req.user?.id ?? row.author,
        createdAt: previous?.createdAt ?? now.toISOString(),
      }
    })
  }

  return data
}
