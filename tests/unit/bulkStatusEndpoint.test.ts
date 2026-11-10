import { ValidationError } from 'payload'
import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { bulkStatus } from '../../src/endpoints/bulkStatus'
import { MAX_BULK_SIZE } from '../../src/lib/bulkStatusBatches'

const admin = { id: 1, roles: ['admin'] }
const agent = { id: 2, roles: ['agent'] }

// A fake request: the caller, the JSON body, and payload.update.
type Update = (args: { id: number }) => Promise<unknown>

function fakeReq(user: unknown, body: unknown, update = vi.fn<Update>(async () => ({}))) {
  const json = body instanceof Error ? vi.fn(async () => Promise.reject(body)) : vi.fn(async () => body)
  const req = { user, json, payload: { update } } as unknown as PayloadRequest
  return { req, update }
}

async function call(req: PayloadRequest) {
  const response = await bulkStatus(req)
  return { status: response.status, body: await response.json() }
}

describe('POST /api/tickets/bulk-status: who may call it', () => {
  it('refuses a logged-out caller with 401', async () => {
    const { req, update } = fakeReq(null, { ids: [1], status: 'closed' })
    expect((await call(req)).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a user without a staff role with 403', async () => {
    const { req, update } = fakeReq({ id: 3, roles: [] }, { ids: [1], status: 'closed' })
    expect((await call(req)).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('accepts agents and admins', async () => {
    for (const user of [agent, admin]) {
      const { req } = fakeReq(user, { ids: [1], status: 'closed' })
      expect((await call(req)).status).toBe(200)
    }
  })
})

describe('POST /api/tickets/bulk-status: request validation', () => {
  it.each([
    ['a body that is not JSON', new SyntaxError('bad json')],
    ['no ids', { status: 'closed' }],
    ['an empty id list', { ids: [], status: 'closed' }],
    ['a non-integer id', { ids: [1, 'x'], status: 'closed' }],
    ['a zero id', { ids: [0], status: 'closed' }],
    ['more ids than the limit', { ids: Array.from({ length: MAX_BULK_SIZE + 1 }, (_, i) => i + 1), status: 'closed' }],
    ['an unknown status', { ids: [1], status: 'open' }],
  ])('answers 400 for %s', async (_case, body) => {
    const { req, update } = fakeReq(admin, body)
    expect((await call(req)).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('accepts exactly the limit', async () => {
    const ids = Array.from({ length: MAX_BULK_SIZE }, (_, i) => i + 1)
    const { req, update } = fakeReq(admin, { ids, status: 'closed' })
    expect((await call(req)).body).toEqual({ updated: MAX_BULK_SIZE, failed: [] })
    expect(update).toHaveBeenCalledTimes(MAX_BULK_SIZE)
  })
})

describe('POST /api/tickets/bulk-status: per-ticket results', () => {
  it('updates each ticket through payload.update with access control on and the caller req', async () => {
    const { req, update } = fakeReq(agent, { ids: [4, 5], status: 'resolved' })
    await call(req)
    expect(update).toHaveBeenCalledWith({
      collection: 'tickets',
      id: 4,
      data: { status: 'resolved' },
      req,
      overrideAccess: false,
    })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('reports refused transitions per ticket and still updates the rest', async () => {
    const update = vi.fn(async ({ id }: { id: number }) => {
      if (id === 7) {
        throw new ValidationError({
          collection: 'tickets',
          errors: [{ message: 'Cannot change status from "closed" to "new".', path: 'status' }],
        })
      }
      if (id === 8) {
        throw new Error('connection reset')
      }
      return {}
    })
    const { req } = fakeReq(admin, { ids: [6, 7, 8, 9], status: 'new' }, update)
    const { status, body } = await call(req)

    expect(status).toBe(200)
    expect(body).toEqual({
      updated: 2,
      failed: [
        { id: 7, error: 'Cannot change status from "closed" to "new".' },
        // Other errors are not passed to the client as is.
        { id: 8, error: 'Update failed' },
      ],
    })
    expect(update).toHaveBeenCalledTimes(4)
  })
})
