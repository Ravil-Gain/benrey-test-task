// When Payload has pushed schema changes in dev mode, it leaves a `payload_migrations` row
// with batch -1. `payload migrate` then prompts "data loss will occur, proceed?" and exits
// with code 0 on anything but yes. On Render nobody can answer, and exit code 0 would let
// `next start` run on an unmigrated schema. So the deploy checks for that row and stops.

export type MigrationRow = { name: string; batch: number | string | null }

export function hasDevPush(rows: MigrationRow[]): boolean {
  return rows.some((row) => Number(row.batch) === -1)
}

export const DEV_PUSH_ERROR =
  'This database has schema changes pushed in dev mode (payload_migrations row with batch -1). ' +
  'Migrations would ask to drop data, so the deploy stops here. Never run `pnpm dev` against ' +
  'this database. To recover, compare the schema with the migrations, then delete the row ' +
  "with name 'dev' and redeploy. See docs/technical-guide.md, section 7."
