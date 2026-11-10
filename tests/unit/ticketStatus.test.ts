import { describe, expect, it } from 'vitest'

import {
  INITIAL_STATUS,
  TICKET_STATUSES,
  isTicketStatus,
  statusPath,
  validateInitialStatus,
  validateStatusChange,
} from '../../src/lib/ticketStatus'

describe('validateStatusChange', () => {
  it('allows the defined transitions', () => {
    expect(validateStatusChange({ from: 'new', to: 'in_progress', hasAssignee: true })).toBeNull()
    expect(validateStatusChange({ from: 'new', to: 'closed', hasAssignee: false })).toBeNull()
    expect(
      validateStatusChange({ from: 'in_progress', to: 'waiting_customer', hasAssignee: true }),
    ).toBeNull()
    expect(validateStatusChange({ from: 'in_progress', to: 'resolved', hasAssignee: true })).toBeNull()
    expect(
      validateStatusChange({ from: 'waiting_customer', to: 'in_progress', hasAssignee: true }),
    ).toBeNull()
    expect(validateStatusChange({ from: 'resolved', to: 'in_progress', hasAssignee: true })).toBeNull()
    expect(validateStatusChange({ from: 'resolved', to: 'closed', hasAssignee: true })).toBeNull()
  })

  it('treats a status change to the same value as a no-op', () => {
    expect(validateStatusChange({ from: 'closed', to: 'closed', hasAssignee: false })).toBeNull()
  })

  it('rejects transitions that skip the workflow', () => {
    const error = validateStatusChange({ from: 'new', to: 'resolved', hasAssignee: true })
    expect(error).toBe('Cannot change status from "New" to "Resolved".')
  })

  it('treats closed as terminal', () => {
    expect(validateStatusChange({ from: 'closed', to: 'in_progress', hasAssignee: true })).not.toBeNull()
    expect(validateStatusChange({ from: 'closed', to: 'new', hasAssignee: true })).not.toBeNull()
  })

  it('requires an assignee before moving to in_progress', () => {
    const error = validateStatusChange({ from: 'new', to: 'in_progress', hasAssignee: false })
    expect(error).toBe('Assign an agent before moving the ticket to "In progress".')
  })

  it('does not require an assignee for other targets', () => {
    expect(validateStatusChange({ from: 'new', to: 'closed', hasAssignee: false })).toBeNull()
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

describe('validateInitialStatus', () => {
  it('lets a ticket start as New, with or without an assignee', () => {
    expect(INITIAL_STATUS).toBe('new')
    expect(validateInitialStatus({ status: 'new', hasAssignee: false })).toBeNull()
    expect(validateInitialStatus({ status: 'new', hasAssignee: true })).toBeNull()
  })

  it('lets a ticket start one allowed step from New', () => {
    expect(validateInitialStatus({ status: 'in_progress', hasAssignee: true })).toBeNull()
    expect(validateInitialStatus({ status: 'closed', hasAssignee: false })).toBeNull()
  })

  it('applies the assignee guard to a ticket that starts in progress', () => {
    expect(validateInitialStatus({ status: 'in_progress', hasAssignee: false })).toBe(
      'Assign an agent before moving the ticket to "In progress".',
    )
  })

  it('refuses statuses that need work on the ticket first', () => {
    expect(validateInitialStatus({ status: 'resolved', hasAssignee: true })).toBe(
      'A new ticket cannot start as "Resolved". Create it as "New" and move it through the workflow.',
    )
    expect(validateInitialStatus({ status: 'waiting_customer', hasAssignee: true })).toMatch(
      /cannot start as "Waiting for customer"/,
    )
  })
})

describe('statusPath', () => {
  it('finds the shortest allowed path from New to every status', () => {
    expect(statusPath('new', 'new')).toEqual([])
    expect(statusPath('new', 'in_progress')).toEqual(['in_progress'])
    expect(statusPath('new', 'closed')).toEqual(['closed'])
    expect(statusPath('new', 'waiting_customer')).toEqual(['in_progress', 'waiting_customer'])
    expect(statusPath('new', 'resolved')).toEqual(['in_progress', 'resolved'])
  })

  it('returns null when the target cannot be reached', () => {
    expect(statusPath('closed', 'new')).toBeNull()
    expect(statusPath('resolved', 'new')).toBeNull()
  })

  it('only ever takes allowed steps', () => {
    for (const from of TICKET_STATUSES) {
      for (const to of TICKET_STATUSES) {
        const path = statusPath(from, to)
        if (!path) continue
        let current = from
        for (const step of path) {
          expect(validateStatusChange({ from: current, to: step, hasAssignee: true })).toBeNull()
          current = step
        }
        expect(current).toBe(to)
      }
    }
  })

  it('reaches every status from New, so the seed can build any status', () => {
    for (const status of TICKET_STATUSES) {
      const path = statusPath(INITIAL_STATUS, status)
      expect(path).not.toBeNull()
      const first = path![0] ?? INITIAL_STATUS
      expect(validateInitialStatus({ status: first, hasAssignee: true })).toBeNull()
    }
  })
})
