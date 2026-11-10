'use client'

import { Button, toast, useSelection } from '@payloadcms/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

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
  type BulkResult,
} from '../lib/bulkStatusBatches'
import { TICKET_STATUS_LABELS, TICKET_STATUSES, type TicketStatus } from '../lib/ticketStatus'

type LastResult = { result: BulkResult; label: string; subjects: Record<number, string> } | null

// The list re-mounts this component when it refreshes after an update, which would drop
// component state. The failures of the last run live here, so they stay on screen until
// the user dismisses them.
let lastResult: LastResult = null

// Bulk status change on the tickets list. Shown above the table when tickets are selected.
// It only collects the ids and calls POST /api/tickets/bulk-status. The endpoint checks the
// caller's role and applies the workflow rules to each ticket, so nothing here can bypass them.
export function BulkStatusBar() {
  const { count, getQueryParams, getSelectedIds, selectAll, toggleAll, totalDocs } = useSelection()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<TicketStatus>('in_progress')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResultState] = useState<LastResult>(() => lastResult)
  const setResult = (next: LastResult) => {
    lastResult = next
    setResultState(next)
  }

  const acrossPages = selectAll === 'allAvailable'
  const selectedCount = acrossPages ? totalDocs : count
  if (!selectedCount && !result) {
    return null
  }

  async function collectIds(): Promise<number[]> {
    if (!acrossPages) {
      return toTicketIds(getSelectedIds())
    }
    // Across pages: the ids come from the list query plus the search box (see searchFilter).
    const query = getQueryParams(searchFilter(searchParams.get('search')))
    const response = await fetch(
      `/api/tickets${query}${query ? '&' : '?'}depth=0&limit=${MAX_BULK_SIZE + 1}&select[id]=true`,
      { credentials: 'include' },
    )
    if (!response.ok) {
      throw new Error(`Could not load the selected tickets (HTTP ${response.status}).`)
    }
    const body = (await response.json()) as { docs?: { id: number | string }[]; totalDocs?: number }
    if ((body.totalDocs ?? 0) > MAX_BULK_SIZE) {
      throw new Error(
        `${body.totalDocs} tickets match. Narrow the list to ${MAX_BULK_SIZE} or fewer with filters or search.`,
      )
    }
    return toTicketIds((body.docs ?? []).map((doc) => doc.id))
  }

  async function apply() {
    const label = TICKET_STATUS_LABELS[status]
    let ids: number[]
    try {
      ids = await collectIds()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the selected tickets.')
      return
    }
    if (ids.length === 0) {
      toast.error('No tickets selected.')
      return
    }
    if (ids.length > MAX_BULK_SIZE) {
      toast.error(`Select ${MAX_BULK_SIZE} tickets or fewer.`)
      return
    }
    if (!window.confirm(`Move ${ids.length} ticket${ids.length === 1 ? '' : 's'} to "${label}"?`)) {
      return
    }

    setResult(null)
    const results: BulkResult[] = []
    setProgress({ done: 0, total: ids.length })
    for (const batch of chunk(ids, BULK_BATCH_SIZE)) {
      try {
        const response = await fetch('/api/tickets/bulk-status', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch, status }),
        })
        const body: unknown = await response.json().catch(() => null)
        results.push(parseBulkResponse(batch, response.status, body))
      } catch {
        results.push(failBatch(batch, 'Network error, the server was not reached'))
      }
      setProgress((current) => current && { ...current, done: current.done + batch.length })
    }
    setProgress(null)

    const merged = mergeBulkResults(results)
    const summary = summarizeBulk(merged, label)
    if (summary.kind === 'success') {
      toast.success(summary.message)
    } else if (summary.kind === 'partial') {
      toast.warning(summary.message)
    } else {
      toast.error(summary.message)
    }
    const subjects = merged.failed.length > 0 ? await loadSubjects(merged.failed.map((f) => f.id)) : {}
    setResult(merged.failed.length > 0 ? { result: merged, label, subjects } : null)
    // Clear the selection (toggleAll resets any partial or full selection), then reload the
    // list so the new statuses show.
    toggleAll()
    router.refresh()
  }

  const busy = progress !== null

  return (
    <div
      style={{
        border: '1px solid var(--theme-elevation-150)',
        borderRadius: 'var(--style-radius-m)',
        padding: 'calc(var(--base) * 0.75)',
        marginBottom: 'var(--base)',
        display: 'grid',
        gap: 'calc(var(--base) * 0.5)',
      }}
    >
      {selectedCount ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'calc(var(--base) * 0.5)' }}>
          <label htmlFor="bulk-status-select">
            Change status of {selectedCount} selected ticket{selectedCount === 1 ? '' : 's'} to
          </label>
          <select
            id="bulk-status-select"
            value={status}
            disabled={busy}
            onChange={(event) => setStatus(event.target.value as TicketStatus)}
            style={{
              background: 'var(--theme-input-bg)',
              color: 'var(--theme-text)',
              border: '1px solid var(--theme-elevation-150)',
              borderRadius: 'var(--style-radius-s)',
              padding: '4px 8px',
            }}
          >
            {TICKET_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TICKET_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <Button buttonStyle="primary" size="small" margin={false} disabled={busy} onClick={apply}>
            {busy ? `Updating ${progress.done} / ${progress.total}…` : 'Apply'}
          </Button>
        </div>
      ) : null}

      {result ? (
        <div role="status">
          <strong>
            {result.result.failed.length} ticket{result.result.failed.length === 1 ? '' : 's'} not moved to
            &quot;{result.label}&quot;:
          </strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 'calc(var(--base) * 1.25)' }}>
            {groupFailures(result.result.failed).map(({ error, ids }) => (
              <li key={error}>
                {error} ({ids.length}):{' '}
                {ids.slice(0, 10).map((id, index) => (
                  <span key={id}>
                    {index > 0 ? ', ' : ''}
                    <a href={`/admin/collections/tickets/${id}`}>{result.subjects[id] ?? `Ticket ${id}`}</a>
                  </span>
                ))}
                {ids.length > 10 ? `, and ${ids.length - 10} more` : ''}
              </li>
            ))}
          </ul>
          <Button buttonStyle="secondary" size="small" onClick={() => setResult(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// Subjects of the tickets that did not move, so the failure list names them the way the
// table does. A failed lookup only loses the names: the ids still link to each ticket.
async function loadSubjects(ids: number[]): Promise<Record<number, string>> {
  try {
    const where = ids.map((id, index) => `where[id][in][${index}]=${id}`).join('&')
    const response = await fetch(
      `/api/tickets?depth=0&limit=${ids.length}&select[subject]=true&${where}`,
      { credentials: 'include' },
    )
    if (!response.ok) {
      return {}
    }
    const body = (await response.json()) as { docs?: { id: number; subject?: string }[] }
    return Object.fromEntries((body.docs ?? []).map((doc) => [doc.id, doc.subject ?? `Ticket ${doc.id}`]))
  } catch {
    return {}
  }
}
