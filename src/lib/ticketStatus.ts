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

// Shown in the admin: the status select, the list column, and the bulk status bar.
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  waiting_customer: 'Waiting for customer',
  resolved: 'Resolved',
  closed: 'Closed',
}

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
    const from = TICKET_STATUS_LABELS[input.from]
    const to = TICKET_STATUS_LABELS[input.to]
    return `Cannot change status from "${from}" to "${to}".`
  }
  if (input.to === 'in_progress' && !input.hasAssignee) {
    return `Assign an agent before moving the ticket to "${TICKET_STATUS_LABELS.in_progress}".`
  }
  return null
}

// Every ticket starts here. The create form does not offer a status, and the tickets hook
// refuses any other start status, so the workflow is the only way to reach the others.
export const INITIAL_STATUS: TicketStatus = 'new'

// Returns an error message if a new ticket may not start in `status`, or null if it may.
export function validateInitialStatus(status: TicketStatus): string | null {
  if (status === INITIAL_STATUS) {
    return null
  }
  const label = TICKET_STATUS_LABELS[status]
  return `A new ticket starts as "${TICKET_STATUS_LABELS[INITIAL_STATUS]}", not "${label}". Change the status after the ticket is created.`
}

// The statuses the edit form offers for a ticket stored in `current`: the status it has now,
// then the allowed next steps. Without a stored status (a new ticket) only "New".
export function statusChoices(current: TicketStatus | undefined): TicketStatus[] {
  if (!current) {
    return [INITIAL_STATUS]
  }
  return [current, ...NEXT_STATUSES[current]]
}

// The shortest list of allowed moves from `from` to `to`, not including `from`. Empty when
// they are the same, null when `to` cannot be reached. The seed uses it to walk tickets
// through the workflow instead of creating them in a status they could not start in.
export function statusPath(from: TicketStatus, to: TicketStatus): TicketStatus[] | null {
  if (from === to) {
    return []
  }
  const previous = new Map<TicketStatus, TicketStatus>()
  const queue: TicketStatus[] = [from]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of NEXT_STATUSES[current]) {
      if (next === from || previous.has(next)) {
        continue
      }
      previous.set(next, current)
      if (next === to) {
        // Walk back from the target to the start, then drop the start.
        const path: TicketStatus[] = []
        for (let step: TicketStatus | undefined = to; step && step !== from; step = previous.get(step)) {
          path.unshift(step)
        }
        return path
      }
      queue.push(next)
    }
  }
  return null
}
