import { describe, expect, it } from 'vitest'

import { assertTestDatabase, maintenanceUrl, testDatabaseUrl } from '../integration/testDatabase'

const DEV = 'postgresql://user:pw@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require'

describe('testDatabaseUrl', () => {
  it('derives a separate "_test" database on the same server from DATABASE_URL', () => {
    const url = new URL(testDatabaseUrl({ DATABASE_URL: DEV }))
    expect(url.pathname).toBe('/neondb_test')
    expect(url.host).toBe('ep-x-pooler.eu-central-1.aws.neon.tech')
    expect(url.searchParams.get('sslmode')).toBe('require')
  })

  it('does not add the suffix twice', () => {
    expect(
      new URL(testDatabaseUrl({ DATABASE_URL: DEV.replace('/neondb', '/neondb_test') })).pathname,
    ).toBe('/neondb_test')
  })

  it('prefers TEST_DATABASE_URL when it is set', () => {
    const explicit = DEV.replace('/neondb', '/other_test')
    expect(testDatabaseUrl({ DATABASE_URL: DEV, TEST_DATABASE_URL: explicit })).toBe(explicit)
  })

  it('needs one of the two variables', () => {
    expect(() => testDatabaseUrl({})).toThrow(/DATABASE_URL/)
  })
})

describe('assertTestDatabase', () => {
  it('refuses a database whose name does not end in _test, so dev and production are safe', () => {
    expect(() => assertTestDatabase(DEV)).toThrow(/Refusing to run integration tests on "neondb"/)
    expect(() => testDatabaseUrl({ TEST_DATABASE_URL: DEV })).toThrow(/Refusing/)
  })
})

describe('maintenanceUrl', () => {
  it('points at the original database on the same server, to create the test one', () => {
    const test = testDatabaseUrl({ DATABASE_URL: DEV })
    expect(new URL(maintenanceUrl(test, DEV)).pathname).toBe('/neondb')
  })
})
