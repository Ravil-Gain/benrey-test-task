/**
 * Runs pending migrations before the server starts (`pnpm start:prod`). Usage:
 *   pnpm migrate
 *
 * Same as `payload migrate`, with one difference: it fails with exit code 1 when the
 * database has a dev-mode push, instead of prompting and exiting with 0 (see
 * src/lib/migrationGuard.ts). Any failure stops `next start`, so the deploy fails and the
 * previous version keeps serving.
 */
import 'dotenv/config'
import { getPayload } from 'payload'

import { DEV_PUSH_ERROR, hasDevPush, type MigrationRow } from '../lib/migrationGuard'
import config from '../payload.config'

async function main(): Promise<void> {
  // Tells Payload this process only migrates, as the payload CLI does.
  process.env.PAYLOAD_MIGRATING = 'true'
  const payload = await getPayload({ config })

  try {
    const pool = payload.db.pool
    // A fresh database has no migrations table yet. Then there is nothing to check.
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
