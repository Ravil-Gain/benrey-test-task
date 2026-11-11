// Which database the integration tests use. Kept free of Payload and pg imports, so the unit
// tests can check the safety rules directly.
//
// By default it is a separate database on the same Neon branch as DATABASE_URL, named
// "<name>_test", so dev data is never touched. TEST_DATABASE_URL overrides it.

export const TEST_DATABASE_SUFFIX = '_test'

export type DatabaseEnv = {
  DATABASE_URL?: string
  TEST_DATABASE_URL?: string
  [key: string]: string | undefined
}

export function testDatabaseUrl(env: DatabaseEnv): string {
  const explicit = env.TEST_DATABASE_URL?.trim()
  if (explicit) {
    return assertTestDatabase(explicit)
  }
  const base = env.DATABASE_URL?.trim()
  if (!base) {
    throw new Error('Set DATABASE_URL (the test database is derived from it) or TEST_DATABASE_URL')
  }
  const url = new URL(base)
  const name = databaseName(url)
  url.pathname = `/${name.endsWith(TEST_DATABASE_SUFFIX) ? name : name + TEST_DATABASE_SUFFIX}`
  return url.toString()
}

// The tests create and delete rows, so they refuse any database whose name does not end in
// "_test". That keeps them off the dev and production databases even if a variable is wrong.
export function assertTestDatabase(value: string): string {
  const name = databaseName(new URL(value))
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run integration tests on "${name}": the database name must end in "${TEST_DATABASE_SUFFIX}"`,
    )
  }
  return value
}

// The URL of the same server's original database, used once to create the test database.
export function maintenanceUrl(testUrl: string, original: string): string {
  const url = new URL(testUrl)
  url.pathname = `/${databaseName(new URL(original))}`
  return url.toString()
}

export function databaseName(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!name) {
    throw new Error('The connection string has no database name')
  }
  return name
}
