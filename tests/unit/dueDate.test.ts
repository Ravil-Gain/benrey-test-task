import { describe, expect, it } from 'vitest'

import {
  computeDueAt,
  describeDueWindows,
  isOverdue,
  overdueWhere,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
} from '../../src/lib/dueDate'
import { TICKET_STATUSES } from '../../src/lib/ticketStatus'

const HOUR = 60 * 60 * 1000
const createdAt = new Date('2026-11-10T10:00:00.000Z')

describe('computeDueAt', () => {
  it.each([
    ['urgent', 4],
    ['high', 24],
    ['normal', 72],
    ['low', 168],
  ] as const)('adds the window for %s priority', (priority, hours) => {
    expect(computeDueAt(priority, createdAt).getTime()).toBe(createdAt.getTime() + hours * HOUR)
  })

  it('describes the windows from the same table, with a label per priority', () => {
    expect(describeDueWindows()).toBe(
      'Urgent 4 hours, High 24 hours, Normal 72 hours, Low 168 hours',
    )
    expect(Object.keys(TICKET_PRIORITY_LABELS).sort()).toEqual([...TICKET_PRIORITIES].sort())
  })
})

describe('isOverdue', () => {
  const dueAt = new Date('2026-11-10T12:00:00.000Z')

  it('is overdue when past due and still open', () => {
    const now = new Date('2026-11-10T13:00:00.000Z')
    expect(isOverdue({ dueAt, status: 'in_progress', now })).toBe(true)
    expect(isOverdue({ dueAt, status: 'new', now })).toBe(true)
    expect(isOverdue({ dueAt, status: 'waiting_customer', now })).toBe(true)
  })

  it('is not overdue before the due time, once done, or without a due date', () => {
    expect(isOverdue({ dueAt, status: 'new', now: new Date('2026-11-10T11:00:00.000Z') })).toBe(
      false,
    )
    const later = new Date('2026-11-11T00:00:00.000Z')
    expect(isOverdue({ dueAt, status: 'resolved', now: later })).toBe(false)
    expect(isOverdue({ dueAt, status: 'closed', now: later })).toBe(false)
    expect(isOverdue({ dueAt: null, status: 'new', now: later })).toBe(false)
  })

  it('accepts a due date stored as an ISO string', () => {
    const now = new Date('2026-11-10T13:00:00.000Z')
    expect(isOverdue({ dueAt: dueAt.toISOString(), status: 'new', now })).toBe(true)
  })
})

describe('overdueWhere', () => {
  const now = new Date('2026-11-10T13:00:00.000Z')
  const [group] = overdueWhere(now).or
  const [dueCondition, statusCondition] = group!.and

  it('asks for tickets past the given time in an open status', () => {
    expect(dueCondition).toEqual({ dueAt: { less_than: '2026-11-10T13:00:00.000Z' } })
    expect(statusCondition).toEqual({ status: { in: ['new', 'in_progress', 'waiting_customer'] } })
  })

  it('matches isOverdue for every status', () => {
    const statuses = (statusCondition as { status: { in: string[] } }).status.in
    for (const status of TICKET_STATUSES) {
      expect(statuses.includes(status)).toBe(
        isOverdue({ dueAt: '2026-11-10T12:00:00.000Z', status, now }),
      )
    }
  })
})
