// The one place that says which status changes are allowed.
// The tickets hook and the bulk status endpoint both call this file.

export const TICKET_STATUSES = [
  'new',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
] as const

export type TicketStatus = (typeof TICKET_STATUSES)[number]

const NEXT_STATUSES: Record<TicketStatus, TicketStatus[]> = {
  new: ['in_progress', 'closed'],
  in_progress: ['waiting_customer', 'resolved'],
  waiting_customer: ['in_progress', 'resolved'],
  resolved: ['in_progress', 'closed'],
  closed: [],
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value)
}

// Returns an error message if the change is not allowed, or null if it is.
// Setting a ticket to the status it already has is always fine.
export function validateStatusChange(input: {
  from: TicketStatus
  to: TicketStatus
  hasAssignee: boolean
}): string | null {
  if (input.from === input.to) {
    return null
  }
  if (!NEXT_STATUSES[input.from].includes(input.to)) {
    return `Cannot change status from "${input.from}" to "${input.to}".`
  }
  if (input.to === 'in_progress' && !input.hasAssignee) {
    return 'Assign an agent before moving the ticket to "in_progress".'
  }
  return null
}
