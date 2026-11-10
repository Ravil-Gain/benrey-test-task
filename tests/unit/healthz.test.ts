import { describe, expect, it } from 'vitest'

import { GET, dynamic } from '../../src/app/(frontend)/healthz/route'

describe('GET /healthz', () => {
  it('answers 200 with a fixed body that is never cached', async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('is rendered on every request, not at build time', () => {
    expect(dynamic).toBe('force-dynamic')
  })
})
