import { describe, expect, it } from 'vitest'

import { DEV_PUSH_ERROR, hasDevPush } from '../../src/lib/migrationGuard'

describe('hasDevPush', () => {
  it('finds the dev-mode row, which Postgres returns with batch as a string', () => {
    expect(
      hasDevPush([
        { name: '20261111_214315_initial', batch: '1' },
        { name: 'dev', batch: '-1' },
      ]),
    ).toBe(true)
    expect(hasDevPush([{ name: 'dev', batch: -1 }])).toBe(true)
  })

  it('passes a database that was only migrated', () => {
    expect(hasDevPush([{ name: '20261111_214315_initial', batch: '1' }])).toBe(false)
  })

  it('passes a fresh database and rows without a batch', () => {
    expect(hasDevPush([])).toBe(false)
    expect(hasDevPush([{ name: 'odd', batch: null }])).toBe(false)
  })

  it('tells the operator what happened and how to recover', () => {
    expect(DEV_PUSH_ERROR).toMatch(/batch -1/)
    expect(DEV_PUSH_ERROR).toMatch(/name 'dev'/)
    expect(DEV_PUSH_ERROR).toMatch(/technical-guide/)
  })
})
