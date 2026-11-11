// Runs once before the integration tests: creates the test database if it does not exist and
// applies the committed migrations to it with `pnpm migrate`, the same command production runs.
import 'dotenv/config'
import { execFileSync } from 'child_process'
import pg from 'pg'

import { databaseName, maintenanceUrl, testDatabaseUrl } from './testDatabase'

export default async function setup(): Promise<void> {
  const testUrl = testDatabaseUrl(process.env)
  const name = databaseName(new URL(testUrl))

  const admin = new pg.Client({
    connectionString: maintenanceUrl(testUrl, process.env.DATABASE_URL ?? testUrl),
  })
  await admin.connect()
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [name])
    if (!rowCount) {
      // Identifiers cannot be bound as parameters. The name was checked to end in "_test".
      await admin.query(`create database "${name.replace(/"/g, '""')}"`)
    }
  } finally {
    await admin.end()
  }

  execFileSync('pnpm', ['-s', 'migrate'], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}
