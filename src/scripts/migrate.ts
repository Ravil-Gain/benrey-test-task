/**
 * Runs pending migrations (`pnpm migrate`, also the first half of `pnpm start:prod`).
 *
 * Same as `payload migrate`, except that a database with a dev-mode push fails with exit
 * code 1 instead of prompting and exiting with 0 (see src/lib/migrationGuard.ts). Any failure
 * stops `next start`, so a bad deploy never serves an unmigrated schema.
 */
import 'dotenv/config'
import { getPayload } from 'payload'

import { DEV_PUSH_ERROR, hasDevPush, type MigrationRow } from '../lib/migrationGuard'
import config from '../payload.config'

async function main(): Promise<void> {
  process.env.PAYLOAD_MIGRATING = 'true'
  const payload = await getPayload({ config })

  try {
    const pool = payload.db.pool
    const { rows: tables } = await pool.query<{ table: string | null }>(
      "select to_regclass('public.payload_migrations')::text as table",
    )
    if (tables[0]?.table) {
      const { rows } = await pool.query<MigrationRow>('select name, batch from payload_migrations')
      if (hasDevPush(rows)) {
        throw new Error(DEV_PUSH_ERROR)
      }
    }

    await payload.db.migrate()
    payload.logger.info('Migrations are up to date.')
  } finally {
    await payload.destroy()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
