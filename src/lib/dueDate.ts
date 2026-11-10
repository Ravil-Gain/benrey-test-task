/**
 * Due-date rules. `dueAt` is set once on create from priority. A ticket is
 * overdue when it is past `dueAt` and still open. This is computed on read,
 * with no background job.
 */
import type { TicketStatus } from './ticketStatus'

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

const DUE_WINDOW_HOURS: Record<TicketPriority, number> = {
  urgent: 4,
  high: 24,
  normal: 72,
  low: 168,
}

const MS_PER_HOUR = 60 * 60 * 1000

export function computeDueAt(priority: TicketPriority, createdAt: Date): Date {
  return new Date(createdAt.getTime() + DUE_WINDOW_HOURS[priority] * MS_PER_HOUR)
}

export function isOverdue(input: {
  dueAt: Date | string | null | undefined
  status: TicketStatus
  now: Date
}): boolean {
  if (!input.dueAt) {
    return false
  }
  if (input.status === 'resolved' || input.status === 'closed') {
    return false
  }
  return new Date(input.dueAt).getTime() < input.now.getTime()
}
