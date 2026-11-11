# Architecture

Decision records for the Support Ticket Tracker. How each decision is implemented is in the [technical guide](technical-guide.md); what the app does and why this stack is in the [README](../README.md).

## Shape

```
   Browser (Payload admin + custom components)
          │ HTTPS
          ▼
 ┌──────────────────────────────────────────┐        ┌──────────────────────────┐
 │ Render Node web service (free)           │  SQL   │ Neon PostgreSQL          │
 │  Next.js + Payload CMS 3                 ├───────▶│  managed, migrations     │
 │   ├─ /admin  (role-based admin UI)       │        └──────────────────────────┘
 │   ├─ /api    (REST, bulk-status, AI)     │  S3 API┌──────────────────────────┐
 │   ├─ file route (access-controlled)      ├───────▶│ Cloudflare R2            │
 │   └─ collection hooks (business rules)   │        │  private bucket          │
 └──────────────────────────────────────────┘        └──────────────────────────┘
          │ HTTPS, key from env, 10 s timeout                 ▲
          ▼                                                   │ signed PUT
 ┌──────────────────────────┐                              Browser
 │ Groq API (gpt-oss-20b)   │
 └──────────────────────────┘
```

One Node process. No queue, no worker, no second API, no second UI.

## Data model

| Collection | Key fields | Relations |
|---|---|---|
| `users` (auth) | email, name, `roles` (`admin`, `agent`, no default) | |
| `customers` | name, email (unique), company, `tickets` (join, read-only) | |
| `tags` | name (unique), color (hex) | |
| `tickets` | subject, description, status, priority, dueAt, resolvedAt, closedAt, isOverdue (virtual), comments (array rows) | FK `customer` (required), FK `assignee` (agents only), many-to-many `tags`; comment rows: FK `author`, many-to-many `media` |
| `media` (upload) | file, alt | |

Access: admins do everything. Agents read and write tickets and customers, read tags, media and users, update their own account, and cannot delete anything or manage users and tags.

## Decisions

### ADR-1: Payload CMS 3 on Next.js, one TypeScript codebase
- **Choice:** Payload 3 generates the admin from collection configs and ships auth, access control, uploads, a REST and a local API. Django admin was the first plan and was dropped for the same generated admin in one language with types generated from the schema.
- **Trade-off:** Next.js is a heavy dependency for an admin-only app, and custom admin behaviour needs React components. Accepted: the admin is the deliverable.

### ADR-2: Rules in pure functions, enforced in hooks
- **Choice:** The workflow (`src/lib/ticketStatus.ts`), due dates (`src/lib/dueDate.ts`), comment rights (`src/lib/comments.ts`) and upload checks (`src/lib/uploadRules.ts`) are pure functions with no Payload import. The `tickets`, `users` and `media` hooks call them, so the admin, the REST API, the bulk endpoint and the seed follow the same rules. Fields the server owns (`dueAt`, `resolvedAt`, `closedAt`) have field-level `access` that drops client values before the hook runs.
- **Trade-off:** Two layers for one rule. Small cost; the rules are unit tested without a database and the hooks are tested with fakes.

### ADR-3: Roles as access functions
- **Choice:** `users.roles` plus `access` functions on every collection (`src/lib/access.ts`). Hidden sidebar entries and missing buttons are consequences of the same functions, never the restriction itself. The `assignee` relationship is limited to agents with `filterOptions`, which Payload checks again on save.
- **Trade-off:** Collection-level only. Agents see all tickets; row-level rules would be the next step.

### ADR-4: Comments as array rows on the ticket
- **Choice:** Comments are an array field, which gives inline editing on the ticket for free (Payload stores them in `tickets_comments`). The hook sets author and time, lets only the author or an admin edit or remove a row, and a duplicated ticket starts without comments (Payload gives copied rows new ids, so the authors could not be kept).
- **Trade-off:** Comments cannot be listed across tickets. Fine for an admin where they are always read with their ticket.

### ADR-5: Due date from priority, overdue as a query
- **Choice:** `dueAt = createdAt + window(priority)`, recomputed when the priority changes. "Overdue" is `dueAt < now AND status IN (open statuses)`: a virtual field on read and the same condition as a one-click list filter on indexed columns. No stored flag, no job to keep it fresh.
- **Trade-off:** Escalating an old ticket to urgent can make it overdue at once. That is the point of escalation.

### ADR-6: Private R2 bucket, direct browser uploads, server-side checks
- **Choice:** `@payloadcms/storage-s3` with `clientUploads`: staff get a signed PUT URL, the browser uploads straight to R2, and the `media` document is created only with a receipt the server signed. The `media` hook then reads the stored bytes once and checks MIME, size, extension and magic bytes, deleting the upload folder on failure. Files are served only through Payload's access-checked file route. Storage keys are a random folder plus the sanitized file name; the sanitized name is what the admin shows.
- **Trade-off:** The server still reads each file once for validation and thumbnails. The R2 bucket's CORS list must include every admin origin (`pnpm r2:cors`).

### ADR-7: Migrations in the start command, guarded
- **Choice:** Render's free plan has no pre-deploy step, so `pnpm start:prod` runs `pnpm migrate` before `next start`. The wrapper fails with exit code 1 when the database carries a dev-mode push marker, which plain `payload migrate` would turn into a prompt nobody can answer. Schema changes are generated with `migrate:create` and committed unedited.
- **Trade-off:** Each cold start spends a few seconds checking migrations. A paid instance would move this to a pre-deploy command.

### ADR-8: AI field help as one header button on Groq
- **Choice:** One `admin.components.actions` button and `POST /api/ai-help`. The endpoint sends field metadata of the open collection (labels, help texts, select options) and the question, nothing from the database, to Groq `openai/gpt-oss-20b` with a 10-second timeout, 500-character input cap and 10 questions per user per minute. Every failure is a friendly message.
- **Trade-off:** The help knows the form, not the focused field. The rate limit is in memory, enough for one instance.

### ADR-9: Seed through the local API
- **Choice:** `pnpm seed` creates demo data through Payload's local API, so hooks and storage run as for real users, and walks each ticket through the workflow from `new`. `--reset` requires `--confirm=<database host>`.
- **Trade-off:** Slower than SQL inserts (a few minutes for 2,000 tickets against a remote database). Acceptable for a one-off.

## Not used, and when to reconsider

- **Queues and workers.** No background work is in scope. Reconsider for email notifications or SLA escalation.
- **Docker.** Render builds Node directly and development uses a Neon branch. Reconsider when a system package is needed at build time.
- **A search service.** Indexed columns and `like` queries are enough at this scale. Reconsider when search gets slow on real data; try `pg_trgm` first.
- **Payload 4 beta and `@payloadcms/storage-r2`.** Not stable, and the R2 adapter is for Cloudflare Workers only.
- **OAuth sign-in.** A bonus; the role model came first. A new OAuth user would start with no role.
