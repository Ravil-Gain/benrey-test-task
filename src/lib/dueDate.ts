import { OPEN_STATUSES, type TicketStatus } from './ticketStatus'

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

// Hours to answer, counted from when the ticket was created.
const DUE_WINDOW_HOURS: Record<TicketPriority, number> = {
  urgent: 4,
  high: 24,
  normal: 72,
  low: 168,
}

const HOUR_MS = 60 * 60 * 1000

export function computeDueAt(priority: TicketPriority, createdAt: Date): Date {
  return new Date(createdAt.getTime() + DUE_WINDOW_HOURS[priority] * HOUR_MS)
}

export function isOverdue(input: {
  dueAt: Date | string | null | undefined
  status: TicketStatus
  now: Date
}): boolean {
  if (!input.dueAt || !OPEN_STATUSES.includes(input.status)) {
    return false
  }
  return new Date(input.dueAt).getTime() < input.now.getTime()
}

// The same rule as isOverdue, as a query on the indexed columns. The list's "overdue" button
// uses it, so there is no stored flag to keep up to date. The or/and shape is the one the
// admin's filter panel reads back, so the two conditions show there and can be removed.
export function overdueWhere(now: Date): OverdueWhere {
  return {
    or: [
      {
        and: [{ dueAt: { less_than: now.toISOString() } }, { status: { in: [...OPEN_STATUSES] } }],
      },
    ],
  }
}

// The shape of a Payload `Where`, without importing Payload here.
type Condition = Record<string, Record<string, string | string[]>>
export type OverdueWhere = { or: { and: Condition[] }[] }

// "Urgent 4 hours, High 24 hours, Normal 72 hours, Low 168 hours", for the help texts.
export function describeDueWindows(): string {
  return [...TICKET_PRIORITIES]
    .reverse()
    .map((priority) => `${TICKET_PRIORITY_LABELS[priority]} ${DUE_WINDOW_HOURS[priority]} hours`)
    .join(', ')
}
