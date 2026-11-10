import { describe, expect, it } from 'vitest'

import {
  BULK_BATCH_SIZE,
  MAX_BULK_SIZE,
  chunk,
  failBatch,
  groupFailures,
  mergeBulkResults,
  parseBulkResponse,
  searchFilter,
  summarizeBulk,
  toTicketIds,
} from '../../src/lib/bulkStatusBatches'
import { TICKET_STATUS_LABELS, TICKET_STATUSES } from '../../src/lib/ticketStatus'

describe('searchFilter', () => {
  it('turns the list search into the same subject filter the list uses', () => {
    expect(searchFilter('SSO')).toEqual({ subject: { like: 'SSO' } })
    expect(searchFilter('  login loop ')).toEqual({ subject: { like: 'login loop' } })
  })

  it('adds nothing without a search, so the whole filtered list is selected', () => {
    expect(searchFilter(null)).toBeUndefined()
    expect(searchFilter(undefined)).toBeUndefined()
    expect(searchFilter('   ')).toBeUndefined()
  })
})

describe('toTicketIds', () => {
  it('keeps positive integer ids once, from numbers or strings', () => {
    expect(toTicketIds([3, '4', 3, '4', 7])).toEqual([3, 4, 7])
  })

  it('drops anything that is not a positive integer id', () => {
    expect(toTicketIds([0, -1, 1.5, 'abc', '', '12x', 2])).toEqual([2])
  })
})

describe('chunk', () => {
  it('splits into batches of the given size, the last one shorter', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 100)).toEqual([])
  })

  it('turns the 500 maximum into five requests of 100', () => {
    const ids = Array.from({ length: MAX_BULK_SIZE }, (_, i) => i + 1)
    const batches = chunk(ids, BULK_BATCH_SIZE)
    expect(batches).toHaveLength(5)
    expect(batches.every((batch) => batch.length === 100)).toBe(true)
    expect(batches.flat()).toEqual(ids)
  })

  it('refuses a size that would loop forever', () => {
    expect(() => chunk([1], 0)).toThrow()
    expect(() => chunk([1], 1.5)).toThrow()
  })
})

describe('parseBulkResponse', () => {
  const ids = [1, 2, 3]

  it('reads a 200 with per-ticket failures', () => {
    expect(
      parseBulkResponse(ids, 200, { updated: 2, failed: [{ id: 3, error: 'Cannot change status.' }] }),
    ).toEqual({ updated: 2, failed: [{ id: 3, error: 'Cannot change status.' }] })
  })

  it('fails the whole batch on an error status, with the server reason when there is one', () => {
    expect(parseBulkResponse(ids, 403, { error: 'Forbidden' })).toEqual(failBatch(ids, 'Forbidden'))
    expect(parseBulkResponse(ids, 502, null)).toEqual(failBatch(ids, 'Request failed (HTTP 502)'))
  })

  it('fails the whole batch on a 200 with an unexpected body', () => {
    expect(parseBulkResponse(ids, 200, { ok: true })).toEqual(
      failBatch(ids, 'Unexpected response from the server'),
    )
  })

  it('skips malformed failure entries and fills in a missing reason', () => {
    expect(parseBulkResponse(ids, 200, { updated: 1, failed: [{ id: 2 }, { error: 'x' }, null] })).toEqual({
      updated: 1,
      failed: [{ id: 2, error: 'Update failed' }],
    })
  })
})

describe('mergeBulkResults', () => {
  it('adds the updated counts and joins the failures in batch order', () => {
    expect(
      mergeBulkResults([
        { updated: 99, failed: [{ id: 5, error: 'a' }] },
        { updated: 0, failed: failBatch([101, 102], 'b').failed },
        { updated: 40, failed: [] },
      ]),
    ).toEqual({
      updated: 139,
      failed: [
        { id: 5, error: 'a' },
        { id: 101, error: 'b' },
        { id: 102, error: 'b' },
      ],
    })
    expect(mergeBulkResults([])).toEqual({ updated: 0, failed: [] })
  })
})

describe('summarizeBulk', () => {
  it('reports full success, partial success and total failure differently', () => {
    expect(summarizeBulk({ updated: 3, failed: [] }, 'Resolved')).toEqual({
      kind: 'success',
      message: '3 tickets moved to "Resolved".',
    })
    expect(summarizeBulk({ updated: 1, failed: [{ id: 2, error: 'x' }] }, 'Closed')).toEqual({
      kind: 'partial',
      message: '1 ticket moved to "Closed". 1 ticket could not move.',
    })
    expect(summarizeBulk({ updated: 0, failed: failBatch([1, 2], 'x').failed }, 'Closed')).toEqual({
      kind: 'error',
      message: 'No tickets changed. 2 tickets could not move to "Closed".',
    })
  })
})

describe('groupFailures', () => {
  it('groups by reason, largest group first', () => {
    expect(
      groupFailures([
        { id: 1, error: 'closed is final' },
        { id: 2, error: 'needs assignee' },
        { id: 3, error: 'needs assignee' },
      ]),
    ).toEqual([
      { error: 'needs assignee', ids: [2, 3] },
      { error: 'closed is final', ids: [1] },
    ])
  })
})

describe('TICKET_STATUS_LABELS', () => {
  it('has a label for every status', () => {
    expect(Object.keys(TICKET_STATUS_LABELS).sort()).toEqual([...TICKET_STATUSES].sort())
  })
})
