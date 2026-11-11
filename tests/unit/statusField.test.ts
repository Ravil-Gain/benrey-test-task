import { describe, expect, it } from 'vitest'

import { allowedStatusOptions } from '../../src/lib/statusField'
import { TICKET_STATUS_LABELS, TICKET_STATUSES } from '../../src/lib/ticketStatus'

// The options the tickets collection gives the field: every status with its label.
const ALL = TICKET_STATUSES.map((value) => ({ label: TICKET_STATUS_LABELS[value], value }))
const values = (options: { value: string }[]) => options.map((option) => option.value)

describe('allowedStatusOptions', () => {
  it('offers the saved status and its next steps, in workflow order', () => {
    expect(values(allowedStatusOptions(ALL, 'new').options)).toEqual([
      'new',
      'in_progress',
      'closed',
    ])
    expect(values(allowedStatusOptions(ALL, 'waiting_customer').options)).toEqual([
      'waiting_customer',
      'in_progress',
      'resolved',
    ])
  })

  it('keeps the labels of the original options', () => {
    expect(allowedStatusOptions(ALL, 'new').options[1]).toEqual({
      label: 'In progress',
      value: 'in_progress',
    })
  })

  it('explains the next steps under the field', () => {
    expect(allowedStatusOptions(ALL, 'resolved').description).toBe(
      'From "Resolved" the ticket can move to "In progress" or "Closed".',
    )
  })

  it('shows a closed ticket as final, with only its own status', () => {
    const { options, description } = allowedStatusOptions(ALL, 'closed')
    expect(values(options)).toEqual(['closed'])
    expect(description).toBe('"Closed" is final. The status cannot change.')
  })

  it('falls back to New for an unsaved or unknown status', () => {
    for (const saved of [undefined, null, 'open', 42]) {
      expect(values(allowedStatusOptions(ALL, saved).options)).toEqual(['new'])
    }
  })

  it('works with plain string options too', () => {
    expect(allowedStatusOptions([...TICKET_STATUSES], 'in_progress').options).toEqual([
      'in_progress',
      'waiting_customer',
      'resolved',
    ])
  })
})
