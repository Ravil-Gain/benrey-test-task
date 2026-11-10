import { describe, expect, it } from 'vitest'

import { isTicketStatus, validateStatusChange } from '../../src/lib/ticketStatus'

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
    expect(error).toContain('Cannot change status from "new" to "resolved"')
  })

  it('treats closed as terminal', () => {
    expect(validateStatusChange({ from: 'closed', to: 'in_progress', hasAssignee: true })).not.toBeNull()
    expect(validateStatusChange({ from: 'closed', to: 'new', hasAssignee: true })).not.toBeNull()
  })

  it('requires an assignee before moving to in_progress', () => {
    const error = validateStatusChange({ from: 'new', to: 'in_progress', hasAssignee: false })
    expect(error).toContain('Assign an agent')
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
