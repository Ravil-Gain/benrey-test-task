import type { TicketStatus } from './ticketStatus'

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

// Hours we have to answer, counted from when the ticket is created.
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

// A ticket is overdue when it is past its due date and still open.
// We work this out when the ticket is read, so there is no background job.
export function isOverdue(input: {
  dueAt: Date | string | null | undefined
  status: TicketStatus
  now: Date
}): boolean {
  if (!input.dueAt || input.status === 'resolved' || input.status === 'closed') {
    return false
  }
  return new Date(input.dueAt).getTime() < input.now.getTime()
}

// "Urgent 4 hours, High 24 hours, Normal 72 hours, Low 168 hours", for the due date's help
// text. Built from DUE_WINDOW_HOURS, so the text cannot drift from the rule.
export function describeDueWindows(): string {
  const label = (priority: TicketPriority) => priority.charAt(0).toUpperCase() + priority.slice(1)
  return [...TICKET_PRIORITIES]
    .reverse()
    .map((priority) => `${label(priority)} ${DUE_WINDOW_HOURS[priority]} hours`)
    .join(', ')
}
