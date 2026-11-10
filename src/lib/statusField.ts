// What the ticket status field on the edit view offers. No Payload import, so the admin
// component and the unit tests can both use it. The steps come from statusChoices in
// ticketStatus.ts, the one place that defines the workflow.

import { TICKET_STATUS_LABELS, isTicketStatus, statusChoices } from './ticketStatus'

type Option = string | { label: unknown; value: string }

function optionValue(option: Option): string {
  return typeof option === 'string' ? option : option.value
}

// Keeps the options for the saved status and its allowed next steps, in the workflow's order,
// and returns a one-line hint for under the field.
export function allowedStatusOptions<T extends Option>(
  options: readonly T[],
  saved: unknown,
): { options: T[]; description: string } {
  const current = isTicketStatus(saved) ? saved : undefined
  const choices = statusChoices(current)
  const kept = choices.flatMap((status) => options.filter((option) => optionValue(option) === status))

  if (!current) {
    return { options: kept, description: 'New tickets start as "New".' }
  }
  const next = choices.slice(1).map((status) => `"${TICKET_STATUS_LABELS[status]}"`)
  if (next.length === 0) {
    return { options: kept, description: `"${TICKET_STATUS_LABELS[current]}" is final. The status cannot change.` }
  }
  return {
    options: kept,
    description: `From "${TICKET_STATUS_LABELS[current]}" the ticket can move to ${next.join(' or ')}.`,
  }
}
