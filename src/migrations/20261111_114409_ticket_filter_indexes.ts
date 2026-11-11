import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");
  CREATE INDEX "tickets_priority_idx" ON "tickets" USING btree ("priority");
  CREATE INDEX "tickets_due_at_idx" ON "tickets" USING btree ("due_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "tickets_status_idx";
  DROP INDEX "tickets_priority_idx";
  DROP INDEX "tickets_due_at_idx";`)
}
