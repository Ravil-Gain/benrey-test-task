'use client'

import { Button, ConfirmationModal, toast, useConfig, useModal, useSelection } from '@payloadcms/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import { stringify } from 'qs-esm'
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
  type BulkFailure,
  type BulkResult,
} from '../lib/bulkStatusBatches'
import { TARGET_STATUSES, TICKET_STATUS_LABELS, type TicketStatus } from '../lib/ticketStatus'
import './BulkStatusBar.scss'

const CONFIRM_SLUG = 'bulk-status-confirm'

type Failures = { label: string; failed: BulkFailure[]; subjects: Record<number, string> }

// Bulk status change on the tickets list, shown above the table when rows are selected. It
// only collects ids and calls POST /api/tickets/bulk-status: the endpoint checks the caller's
// role and applies the workflow to each ticket, so nothing here can bypass them.
export function BulkStatusBar() {
  const { count, getQueryParams, getSelectedIds, selectAll, toggleAll, totalDocs } = useSelection()
  const { getEntityConfig } = useConfig()
  const { openModal } = useModal()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<TicketStatus>('in_progress')
  const [pending, setPending] = useState<number[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = useState<Failures | null>(null)

  const acrossPages = selectAll === 'allAvailable'
  const selectedCount = acrossPages ? totalDocs : count
  if (!selectedCount && !failures) {
    return null
  }
  const label = TICKET_STATUS_LABELS[status]
  const tickets = (n: number) => `${n} ticket${n === 1 ? '' : 's'}`

  async function collectIds(): Promise<number[]> {
    if (!acrossPages) {
      return toTicketIds(getSelectedIds())
    }
    // "Select all" across pages is the list query plus the search box (see searchFilter).
    const searchable =
      getEntityConfig({ collectionSlug: 'tickets' })?.admin.listSearchableFields ?? []
    const query = getQueryParams(searchFilter(searchParams.get('search'), searchable))
    const extra = stringify({ depth: 0, limit: MAX_BULK_SIZE + 1, select: { id: true } })
    const response = await fetch(`/api/tickets${query}&${extra}`, { credentials: 'include' })
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

  async function confirm() {
    try {
      const ids = await collectIds()
      if (ids.length === 0) {
        toast.error('No tickets selected.')
        return
      }
      setPending(ids)
      openModal(CONFIRM_SLUG)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the selected tickets.')
    }
  }

  async function apply() {
    setFailures(null)
    setProgress({ done: 0, total: pending.length })
    const results: BulkResult[] = []
    for (const batch of chunk(pending, BULK_BATCH_SIZE)) {
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
    if (merged.failed.length > 0) {
      const subjects = await loadSubjects(merged.failed.map((failure) => failure.id))
      setFailures({ label, failed: merged.failed, subjects })
    }
    toggleAll()
    router.refresh()
  }

  const busy = progress !== null

  return (
    <div className="bulk-status-bar">
      {selectedCount ? (
        <div className="bulk-status-bar__controls">
          <label htmlFor="bulk-status-select">
            Change status of {selectedCount} selected ticket{selectedCount === 1 ? '' : 's'} to
          </label>
          <select
            className="bulk-status-bar__select"
            disabled={busy}
            id="bulk-status-select"
            onChange={(event) => setStatus(event.target.value as TicketStatus)}
            value={status}
          >
            {TARGET_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TICKET_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <Button
            buttonStyle="primary"
            disabled={busy}
            margin={false}
            onClick={confirm}
            size="small"
          >
            {busy ? `Updating ${progress.done} / ${progress.total}…` : 'Apply'}
          </Button>
        </div>
      ) : null}

      {failures ? (
        <div className="bulk-status-bar__failures" role="status">
          <strong>
            {tickets(failures.failed.length)} not moved to &quot;{failures.label}&quot;:
          </strong>
          <ul>
            {groupFailures(failures.failed).map(({ error, ids }) => (
              <li key={error}>
                {error} ({ids.length}):{' '}
                {ids.slice(0, 10).map((id, index) => (
                  <span key={id}>
                    {index > 0 ? ', ' : ''}
                    <a href={`/admin/collections/tickets/${id}`}>
                      {failures.subjects[id] ?? `Ticket ${id}`}
                    </a>
                  </span>
                ))}
                {ids.length > 10 ? `, and ${ids.length - 10} more` : ''}
              </li>
            ))}
          </ul>
          <Button buttonStyle="secondary" onClick={() => setFailures(null)} size="small">
            Dismiss
          </Button>
        </div>
      ) : null}

      <ConfirmationModal
        body={`Move ${tickets(pending.length)} to "${label}"? Tickets the workflow does not allow to move are reported and left as they are.`}
        confirmLabel="Apply"
        confirmingLabel="Updating…"
        heading="Change status"
        modalSlug={CONFIRM_SLUG}
        onConfirm={apply}
      />
    </div>
  )
}

// Subjects of the tickets that did not move, so the failure list names them the way the table
// does. A failed lookup only loses the names: the ids still link to each ticket.
async function loadSubjects(ids: number[]): Promise<Record<number, string>> {
  try {
    const query = stringify({
      depth: 0,
      limit: ids.length,
      select: { subject: true },
      where: { id: { in: ids } },
    })
    const response = await fetch(`/api/tickets?${query}`, { credentials: 'include' })
    if (!response.ok) {
      return {}
    }
    const body = (await response.json()) as { docs?: { id: number; subject?: string }[] }
    return Object.fromEntries(
      (body.docs ?? []).map((doc) => [doc.id, doc.subject ?? `Ticket ${doc.id}`]),
    )
  } catch {
    return {}
  }
}
