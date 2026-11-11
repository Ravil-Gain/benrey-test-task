// The one place that defines the ticket workflow. The tickets hook, the bulk endpoint, the
// status field and the AI help all read it from here.

export const TICKET_STATUSES = [
  'new',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
] as const

export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  waiting_customer: 'Waiting for customer',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const INITIAL_STATUS: TicketStatus = 'new'

// Statuses a ticket can still be worked on in. Only these can be overdue.
export const OPEN_STATUSES: readonly TicketStatus[] = ['new', 'in_progress', 'waiting_customer']

const NEXT_STATUSES: Record<TicketStatus, TicketStatus[]> = {
  new: ['in_progress', 'closed'],
  in_progress: ['waiting_customer', 'resolved'],
  waiting_customer: ['in_progress', 'resolved'],
  resolved: ['in_progress', 'closed'],
  closed: [],
}

// Statuses that some other status can move to. The bulk bar offers these.
export const TARGET_STATUSES: readonly TicketStatus[] = TICKET_STATUSES.filter((status) =>
  Object.values(NEXT_STATUSES).some((next) => next.includes(status)),
)

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value)
}

// Null when the move is allowed, otherwise the message to show. Staying put is always allowed.
export function validateStatusChange(input: {
  from: TicketStatus
  to: TicketStatus
}): string | null {
  if (input.from === input.to || NEXT_STATUSES[input.from].includes(input.to)) {
    return null
  }
  return `Cannot change status from "${TICKET_STATUS_LABELS[input.from]}" to "${TICKET_STATUS_LABELS[input.to]}".`
}

// A ticket in progress always has an assignee. Checked on the state being saved, not only
// when the status changes, so clearing the assignee of an in-progress ticket is refused too.
export function validateAssignee(input: {
  status: TicketStatus
  hasAssignee: boolean
}): string | null {
  if (input.status === 'in_progress' && !input.hasAssignee) {
    return `Assign an agent before moving the ticket to "${TICKET_STATUS_LABELS.in_progress}".`
  }
  return null
}

export function validateInitialStatus(status: TicketStatus): string | null {
  if (status === INITIAL_STATUS) {
    return null
  }
  return `A new ticket starts as "${TICKET_STATUS_LABELS[INITIAL_STATUS]}", not "${TICKET_STATUS_LABELS[status]}". Change the status after the ticket is created.`
}

// What the edit form offers: the saved status, then its allowed next steps.
export function statusChoices(current: TicketStatus | undefined): TicketStatus[] {
  if (!current) {
    return [INITIAL_STATUS]
  }
  return [current, ...NEXT_STATUSES[current]]
}

// One sentence per status, for the status field's help text and the AI context.
export function describeWorkflow(): string {
  const steps = TICKET_STATUSES.map((status) => {
    const next = NEXT_STATUSES[status].map((value) => `"${TICKET_STATUS_LABELS[value]}"`)
    return next.length
      ? `"${TICKET_STATUS_LABELS[status]}" can move to ${next.join(' or ')}.`
      : `"${TICKET_STATUS_LABELS[status]}" is final.`
  })
  return [
    `Every ticket starts as "${TICKET_STATUS_LABELS[INITIAL_STATUS]}".`,
    ...steps,
    `A ticket in "${TICKET_STATUS_LABELS.in_progress}" always has an assignee.`,
  ].join(' ')
}
