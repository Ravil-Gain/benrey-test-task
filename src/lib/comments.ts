// Rules for the comment rows on a ticket. No Payload import, so the unit tests run them directly.

export type CommentRow = {
  id?: string | null
  body: string
  attachments?: (number | { id: number })[] | null
  author?: number | { id: number } | null
  createdAt?: string | null
}

function idOf(value: number | { id: number } | null | undefined): number | undefined {
  return typeof value === 'object' && value !== null ? value.id : (value ?? undefined)
}

function attachmentIds(row: CommentRow): string {
  return (row.attachments ?? []).map(idOf).join(',')
}

// Only the author of a comment, or an admin, may change or remove it. Returns the message
// for the first violation, or null.
export function validateCommentChanges(input: {
  before: readonly CommentRow[]
  after: readonly CommentRow[]
  userId: number | undefined
  isAdmin: boolean
}): string | null {
  if (input.isAdmin) {
    return null
  }
  const kept = new Map(input.after.filter((row) => row.id).map((row) => [row.id, row]))
  for (const old of input.before) {
    if (!old.id || idOf(old.author) === input.userId) {
      continue
    }
    const next = kept.get(old.id)
    if (!next) {
      return 'Only the author or an admin can remove a comment.'
    }
    if (next.body !== old.body || attachmentIds(next) !== attachmentIds(old)) {
      return 'Only the author or an admin can edit a comment.'
    }
  }
  return null
}

// Rows that already exist keep their author and time. New rows get the current user and the
// current time, whatever the client sent. Without a user (the seed) the row's author stands.
export function stampComments(input: {
  before: readonly CommentRow[]
  after: readonly CommentRow[]
  userId: number | undefined
  now: string
}): CommentRow[] {
  const existing = new Map(input.before.filter((row) => row.id).map((row) => [row.id, row]))
  return input.after.map((row) => {
    const old = row.id ? existing.get(row.id) : undefined
    return {
      ...row,
      author: old ? old.author : (input.userId ?? row.author),
      createdAt: old?.createdAt ?? input.now,
    }
  })
}
