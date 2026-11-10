import { describe, expect, it } from 'vitest'

import { computeDueAt, isOverdue } from '../../src/lib/dueDate'

const HOUR = 60 * 60 * 1000
const createdAt = new Date('2026-11-10T10:00:00.000Z')

describe('computeDueAt', () => {
  it.each([
    ['urgent', 4],
    ['high', 24],
    ['normal', 72],
    ['low', 168],
  ] as const)('adds the SLA window for %s priority', (priority, hours) => {
    expect(computeDueAt(priority, createdAt).getTime()).toBe(createdAt.getTime() + hours * HOUR)
  })
})

describe('isOverdue', () => {
  const dueAt = new Date('2026-11-10T12:00:00.000Z')

  it('is overdue when past due and still open', () => {
    const now = new Date('2026-11-10T13:00:00.000Z')
    expect(isOverdue({ dueAt, status: 'in_progress', now })).toBe(true)
    expect(isOverdue({ dueAt, status: 'new', now })).toBe(true)
  })

  it('is not overdue before the due time', () => {
    const now = new Date('2026-11-10T11:00:00.000Z')
    expect(isOverdue({ dueAt, status: 'new', now })).toBe(false)
  })

  it('is never overdue once resolved or closed', () => {
    const now = new Date('2026-11-11T00:00:00.000Z')
    expect(isOverdue({ dueAt, status: 'resolved', now })).toBe(false)
    expect(isOverdue({ dueAt, status: 'closed', now })).toBe(false)
  })

  it('is false when there is no due date', () => {
    expect(isOverdue({ dueAt: null, status: 'new', now: new Date() })).toBe(false)
  })

  it('accepts a due date stored as an ISO string', () => {
    const now = new Date('2026-11-10T13:00:00.000Z')
    expect(isOverdue({ dueAt: dueAt.toISOString(), status: 'new', now })).toBe(true)
  })
})
