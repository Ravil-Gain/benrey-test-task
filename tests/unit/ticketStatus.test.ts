import { describe, expect, it } from 'vitest'

import {
  INITIAL_STATUS,
  OPEN_STATUSES,
  TARGET_STATUSES,
  TICKET_STATUSES,
  isTicketStatus,
  statusChoices,
  validateAssignee,
  validateInitialStatus,
  validateStatusChange,
} from '../../src/lib/ticketStatus'

describe('validateStatusChange', () => {
  it.each([
    ['new', 'in_progress'],
    ['new', 'closed'],
    ['in_progress', 'waiting_customer'],
    ['in_progress', 'resolved'],
    ['waiting_customer', 'in_progress'],
    ['waiting_customer', 'resolved'],
    ['resolved', 'in_progress'],
    ['resolved', 'closed'],
  ] as const)('allows %s to %s', (from, to) => {
    expect(validateStatusChange({ from, to })).toBeNull()
  })

  it('treats a change to the same status as a no-op', () => {
    expect(validateStatusChange({ from: 'closed', to: 'closed' })).toBeNull()
  })

  it('rejects moves that skip the workflow, with the labels in the message', () => {
    expect(validateStatusChange({ from: 'new', to: 'resolved' })).toBe(
      'Cannot change status from "New" to "Resolved".',
    )
    expect(validateStatusChange({ from: 'in_progress', to: 'new' })).not.toBeNull()
  })

  it('treats closed as final', () => {
    for (const to of TICKET_STATUSES.filter((status) => status !== 'closed')) {
      expect(validateStatusChange({ from: 'closed', to })).not.toBeNull()
    }
  })
})

describe('validateAssignee', () => {
  it('requires an assignee while a ticket is in progress', () => {
    expect(validateAssignee({ status: 'in_progress', hasAssignee: false })).toBe(
      'Assign an agent before moving the ticket to "In progress".',
    )
    expect(validateAssignee({ status: 'in_progress', hasAssignee: true })).toBeNull()
  })

  it('does not require one in any other status', () => {
    for (const status of TICKET_STATUSES.filter((value) => value !== 'in_progress')) {
      expect(validateAssignee({ status, hasAssignee: false })).toBeNull()
    }
  })
})

describe('validateInitialStatus', () => {
  it('lets a ticket start as New only', () => {
    expect(INITIAL_STATUS).toBe('new')
    expect(validateInitialStatus('new')).toBeNull()
    for (const status of TICKET_STATUSES.filter((value) => value !== 'new')) {
      expect(validateInitialStatus(status)).toMatch(/A new ticket starts as "New", not /)
    }
  })
})

describe('isTicketStatus', () => {
  it('accepts known statuses only', () => {
    expect(isTicketStatus('in_progress')).toBe(true)
    expect(isTicketStatus('archived')).toBe(false)
    expect(isTicketStatus(42)).toBe(false)
    expect(isTicketStatus(undefined)).toBe(false)
  })
})

describe('statusChoices', () => {
  it('offers only New for a ticket that is not saved yet', () => {
    expect(statusChoices(undefined)).toEqual(['new'])
  })

  it('offers the current status first, then the allowed next steps', () => {
    expect(statusChoices('new')).toEqual(['new', 'in_progress', 'closed'])
    expect(statusChoices('resolved')).toEqual(['resolved', 'in_progress', 'closed'])
    expect(statusChoices('closed')).toEqual(['closed'])
  })

  it('never offers a step the workflow refuses', () => {
    for (const from of TICKET_STATUSES) {
      for (const to of statusChoices(from)) {
        expect(validateStatusChange({ from, to })).toBeNull()
      }
    }
  })
})

describe('status groups', () => {
  it('offers every status but New as a bulk target, because nothing moves back to New', () => {
    expect(TARGET_STATUSES).toEqual(['in_progress', 'waiting_customer', 'resolved', 'closed'])
    for (const to of TARGET_STATUSES) {
      expect(
        TICKET_STATUSES.some((from) => from !== to && !validateStatusChange({ from, to })),
      ).toBe(true)
    }
  })

  it('counts resolved and closed as done, everything else as open', () => {
    expect(OPEN_STATUSES).toEqual(['new', 'in_progress', 'waiting_customer'])
  })
})
