import { ValidationError } from 'payload'
import type { CollectionBeforeChangeHook } from 'payload'

import type { Ticket } from '../payload-types'
import { hasRole } from '../lib/access'
import { stampComments, validateCommentChanges, type CommentRow } from '../lib/comments'
import { computeDueAt, type TicketPriority } from '../lib/dueDate'
import {
  INITIAL_STATUS,
  OPEN_STATUSES,
  validateAssignee,
  validateInitialStatus,
  validateStatusChange,
  type TicketStatus,
} from '../lib/ticketStatus'

// The ticket rules, on every write path: admin, REST, local API, bulk endpoint and seed.
export const beforeTicketChange: CollectionBeforeChangeHook<Ticket> = ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const now = new Date()
  const fail = (path: string, message: string) =>
    new ValidationError({ collection: 'tickets', errors: [{ message, path }], req })

  const status = (data.status ?? originalDoc?.status ?? INITIAL_STATUS) as TicketStatus
  const priority = (data.priority ?? originalDoc?.priority ?? 'normal') as TicketPriority
  const assignee = 'assignee' in data ? data.assignee : originalDoc?.assignee

  if (operation === 'create' || !originalDoc) {
    const error = validateInitialStatus(status)
    if (error) {
      throw fail('status', error)
    }
    const createdAt = data.createdAt ? new Date(data.createdAt) : now
    data.dueAt = computeDueAt(priority, createdAt).toISOString()
    data.resolvedAt = null
    data.closedAt = null
  } else {
    if (status !== originalDoc.status) {
      const error = validateStatusChange({ from: originalDoc.status as TicketStatus, to: status })
      if (error) {
        throw fail('status', error)
      }
      if (status === 'resolved') {
        data.resolvedAt = now.toISOString()
      } else if (originalDoc.status === 'resolved' && OPEN_STATUSES.includes(status)) {
        data.resolvedAt = null // reopened
      }
      if (status === 'closed') {
        data.closedAt = now.toISOString()
      }
    }
    if (priority !== originalDoc.priority) {
      data.dueAt = computeDueAt(priority, new Date(originalDoc.createdAt)).toISOString()
    }
  }

  const assigneeError = validateAssignee({ status, hasAssignee: Boolean(assignee) })
  if (assigneeError) {
    throw fail(status === originalDoc?.status ? 'assignee' : 'status', assigneeError)
  }

  if (Array.isArray(data.comments)) {
    const before = (originalDoc?.comments ?? []) as CommentRow[]
    const after = data.comments as CommentRow[]
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined
    const error = validateCommentChanges({
      before,
      after,
      userId,
      isAdmin: hasRole(req.user, 'admin'),
    })
    if (error) {
      throw fail('comments', error)
    }
    data.comments = stampComments({
      before,
      after,
      userId,
      now: now.toISOString(),
    }) as Ticket['comments']
  }

  return data
}
