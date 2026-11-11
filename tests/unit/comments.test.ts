import { describe, expect, it } from 'vitest'

import { stampComments, validateCommentChanges } from '../../src/lib/comments'

const mine = { id: 'a', body: 'mine', author: 7, attachments: [1] }
const theirs = { id: 'b', body: 'theirs', author: { id: 2 }, attachments: [2, { id: 3 }] }
const before = [mine, theirs]

describe('validateCommentChanges', () => {
  it('allows adding comments and editing your own', () => {
    expect(
      validateCommentChanges({
        before,
        after: [{ ...mine, body: 'edited', attachments: [] }, theirs, { body: 'new' }],
        userId: 7,
        isAdmin: false,
      }),
    ).toBeNull()
  })

  it("refuses changing someone else's text or attachments", () => {
    expect(
      validateCommentChanges({
        before,
        after: [mine, { ...theirs, body: 'x' }],
        userId: 7,
        isAdmin: false,
      }),
    ).toBe('Only the author or an admin can edit a comment.')
    expect(
      validateCommentChanges({
        before,
        after: [mine, { ...theirs, attachments: [2] }],
        userId: 7,
        isAdmin: false,
      }),
    ).toBe('Only the author or an admin can edit a comment.')
  })

  it("refuses removing someone else's comment, also by leaving the list out of order", () => {
    expect(validateCommentChanges({ before, after: [mine], userId: 7, isAdmin: false })).toBe(
      'Only the author or an admin can remove a comment.',
    )
    expect(
      validateCommentChanges({ before, after: [theirs, mine], userId: 7, isAdmin: false }),
    ).toBeNull()
  })

  it('compares populated and plain references the same way', () => {
    expect(
      validateCommentChanges({
        before,
        after: [mine, { ...theirs, author: 2, attachments: [{ id: 2 }, 3] }],
        userId: 7,
        isAdmin: false,
      }),
    ).toBeNull()
  })

  it('lets an admin do anything', () => {
    expect(validateCommentChanges({ before, after: [], userId: 1, isAdmin: true })).toBeNull()
  })
})

describe('stampComments', () => {
  const now = '2026-11-11T12:00:00.000Z'

  it('gives new rows the current user and time, whatever the client sent', () => {
    const [row] = stampComments({
      before: [],
      after: [{ body: 'hi', author: 99, createdAt: '2000-01-01' }],
      userId: 7,
      now,
    })
    expect(row).toEqual({ body: 'hi', author: 7, createdAt: now })
  })

  it('keeps the stored author and time of existing rows', () => {
    const old = { id: 'a', body: 'old', author: 2, createdAt: '2026-01-01T00:00:00.000Z' }
    const [row] = stampComments({
      before: [old],
      after: [{ ...old, body: 'edited', author: 7 }],
      userId: 7,
      now,
    })
    expect(row).toEqual({ ...old, body: 'edited' })
  })

  it('keeps the author a new row names when there is no user (the seed)', () => {
    const [row] = stampComments({
      before: [],
      after: [{ body: 'seeded', author: 5 }],
      userId: undefined,
      now,
    })
    expect(row!.author).toBe(5)
  })
})
