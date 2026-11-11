// Client-side plumbing for the bulk status bar. No Payload import, so the admin component and
// the unit tests can both use it. It decides nothing about which moves are allowed: the
// endpoint applies ticketStatus.ts to every ticket and reports the ones it refused.

export const MAX_BULK_SIZE = 500

// Ids go to the endpoint in batches of this size, so the bar can show progress and no single
// request runs long on the free instance.
export const BULK_BATCH_SIZE = 100

// "Select all" across pages selects the list query without its search box. This rebuilds the
// search the same way Payload does (a `like` on each searchable field) so it can be added back.
export function searchFilter(
  search: string | null | undefined,
  fields: readonly string[],
): { or: Record<string, { like: string }>[] } | undefined {
  const value = search?.trim()
  return value ? { or: fields.map((field) => ({ [field]: { like: value } })) } : undefined
}

export type BulkFailure = { id: number; error: string }
export type BulkResult = { updated: number; failed: BulkFailure[] }

// Selection ids arrive as numbers or strings. Keeps positive integers, once each.
export function toTicketIds(raw: readonly (number | string)[]): number[] {
  const ids = new Set<number>()
  for (const value of raw) {
    const id = typeof value === 'number' ? value : Number(value)
    if (Number.isInteger(id) && id > 0) {
      ids.add(id)
    }
  }
  return [...ids]
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('chunk size must be a positive integer')
  }
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size))
  }
  return batches
}

export function mergeBulkResults(results: readonly BulkResult[]): BulkResult {
  return {
    updated: results.reduce((sum, result) => sum + result.updated, 0),
    failed: results.flatMap((result) => result.failed),
  }
}

// A batch the server refused as a whole: every id in it failed with the same reason.
export function failBatch(ids: readonly number[], error: string): BulkResult {
  return { updated: 0, failed: ids.map((id) => ({ id, error })) }
}

export function parseBulkResponse(
  ids: readonly number[],
  status: number,
  body: unknown,
): BulkResult {
  const data = (body ?? {}) as { updated?: unknown; failed?: unknown; error?: unknown }
  if (status !== 200) {
    const reason = typeof data.error === 'string' ? data.error : `Request failed (HTTP ${status})`
    return failBatch(ids, reason)
  }
  if (typeof data.updated !== 'number' || !Array.isArray(data.failed)) {
    return failBatch(ids, 'Unexpected response from the server')
  }
  const failed = data.failed.flatMap((item: unknown) => {
    const entry = item as { id?: unknown; error?: unknown }
    return typeof entry?.id === 'number'
      ? [{ id: entry.id, error: typeof entry.error === 'string' ? entry.error : 'Update failed' }]
      : []
  })
  return { updated: data.updated, failed }
}

export type BulkSummary = { kind: 'success' | 'partial' | 'error'; message: string }

export function summarizeBulk(result: BulkResult, statusLabel: string): BulkSummary {
  const failed = result.failed.length
  const tickets = (count: number) => `${count} ticket${count === 1 ? '' : 's'}`
  if (failed === 0) {
    return { kind: 'success', message: `${tickets(result.updated)} moved to "${statusLabel}".` }
  }
  if (result.updated === 0) {
    return {
      kind: 'error',
      message: `No tickets changed. ${tickets(failed)} could not move to "${statusLabel}".`,
    }
  }
  return {
    kind: 'partial',
    message: `${tickets(result.updated)} moved to "${statusLabel}". ${tickets(failed)} could not move.`,
  }
}

// Groups failures by reason, largest group first, so 300 identical refusals read as one line.
export function groupFailures(failed: readonly BulkFailure[]): { error: string; ids: number[] }[] {
  const groups = new Map<string, number[]>()
  for (const { id, error } of failed) {
    groups.set(error, [...(groups.get(error) ?? []), id])
  }
  return [...groups.entries()]
    .map(([error, ids]) => ({ error, ids }))
    .sort((a, b) => b.ids.length - a.ids.length)
}
