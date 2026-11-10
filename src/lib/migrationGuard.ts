// Decides whether it is safe to run migrations. No Payload import, so the unit tests can run it.
//
// When Payload has pushed schema changes in dev mode, it leaves a `payload_migrations` row
// with batch -1. `payload migrate` then asks "data loss will occur, proceed?" and on any
// answer but yes it exits with code 0. On Render there is no terminal to answer, and exit
// code 0 would let `next start` run on a schema that was never migrated. So the deploy
// checks for that row first and stops with an error instead.

export type MigrationRow = { name: string; batch: number | string | null }

export function hasDevPush(rows: MigrationRow[]): boolean {
  return rows.some((row) => Number(row.batch) === -1)
}

export const DEV_PUSH_ERROR =
  'This database has schema changes pushed in dev mode (payload_migrations row with batch -1). ' +
  'Migrations would ask to drop data, so the deploy stops here. Never run `pnpm dev` against ' +
  'this database. To recover, compare the schema with the migrations, then delete the row ' +
  "with name 'dev' and redeploy. See docs/technical-guide.md, section 12."
