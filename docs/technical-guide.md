# Technical Guide

This document explains how the project is built and configured: every major decision, every config file, every environment variable, and the commands you need. It is written for the author, for the live review call, and for anyone who picks the project up later.

It is kept in sync with the code. When a config file, a dependency, a collection, or a command changes, update the matching section here in the same commit. [docs/architecture.md](architecture.md) holds the decision records (ADRs). This guide explains how those decisions are implemented.

Contents:

1. [What the app does](#1-what-the-app-does)
2. [Repository layout](#2-repository-layout)
3. [Stack and why it was chosen](#3-stack-and-why-it-was-chosen)
4. [Configuration files](#4-configuration-files)
5. [Environment variables](#5-environment-variables)
6. [Runtime configuration: payload.config.ts](#6-runtime-configuration-payloadconfigts)
7. [Data model](#7-data-model)
8. [Business logic: ticket workflow and due dates](#8-business-logic-ticket-workflow-and-due-dates)
9. [Roles and access control](#9-roles-and-access-control)
10. [Bulk status endpoint](#10-bulk-status-endpoint)
11. [Uploads and object storage](#11-uploads-and-object-storage)
12. [Database and migrations](#12-database-and-migrations)
13. [Seed data](#13-seed-data)
14. [Tests](#14-tests)
15. [Commands](#15-commands)
16. [Security notes](#16-security-notes)
17. [Known limitations and next steps](#17-known-limitations-and-next-steps)

---

## 1. What the app does

A support team uses an admin panel to track customer tickets. Staff (admins and agents) create tickets for customers, assign them to agents, move them through a status workflow, add comments with attachments, tag them, and bulk-update their status. Admins also manage staff accounts and tags. Agents cannot delete records or manage users.

The app is built on **Payload CMS 3**. Payload generates the admin UI from TypeScript collection configs, so the admin is the framework's own tooling and not a hand-built UI. Custom code covers only the business rules, the access rules, the upload checks, and the bulk endpoint.

---

## 2. Repository layout

```
.
├── docs/
│   ├── architecture.md          Decision records (ADRs), stack, agent rules
│   └── technical-guide.md       This file
├── src/
│   ├── app/
│   │   ├── (payload)/           Payload admin and REST API routes (generated layout + our additions)
│   │   │   ├── admin/           /admin, the admin UI. importMap.js is generated
│   │   │   ├── api/[...slug]/   Payload REST API (/api/tickets, /api/users, ...)
│   │   │   └── layout.tsx
│   │   └── (frontend)/          Root URL. Redirects to /admin
│   ├── collections/             One file per collection: fields, access, admin options
│   ├── endpoints/               Custom REST endpoints (bulk status)
│   ├── hooks/                   Collection hooks (business rules that run on every write)
│   ├── lib/                     Pure logic with no Payload import: workflow, due dates, roles, env
│   ├── migrations/              Committed database migrations (generated, never hand-edited)
│   ├── plugins/                 Small config plugins (keeps the uploader's file name on direct uploads)
│   ├── seed/                    Demo data generator (pnpm seed)
│   ├── payload.config.ts        Payload runtime configuration (the central file)
│   └── payload-types.ts         TypeScript types generated from the collections (committed)
├── tests/unit/                  Vitest unit tests for lib/ logic
├── package.json                 Scripts, dependencies, pnpm settings
├── pnpm-lock.yaml               Exact dependency versions (commit this)
├── tsconfig.json                TypeScript settings
├── next.config.ts               Next.js settings, wrapped with Payload
├── vitest.config.mts            Unit test settings
├── .env.example                 Template for local secrets (copy to .env)
└── .gitignore                   What git must never commit
```

The split between `lib/` and everything else is deliberate. `lib/` holds the rules (which status changes are allowed, how a due date is computed). It has no dependency on Payload, so it can be unit tested without a database. The hooks and endpoints call `lib/`, so the rules live in one place.

---

## 3. Stack and why it was chosen

| Layer | Choice | Version | Why this, not the alternatives |
|---|---|---|---|
| Admin and CMS | Payload CMS 3 | 3.93.0 (exact) | The admin is generated from TypeScript collection configs. Auth, access control, uploads, and a REST API come in one package. Django admin and AdminJS were considered (see architecture ADR-009). |
| Web framework | Next.js (App Router) | 16.4.2 | Payload 3 runs inside Next.js. Payload's admin is a Next.js app, so there is no second server to run. |
| UI runtime | React | 19.3.1 | Required by Next.js and Payload admin. |
| Language | TypeScript, strict mode | 6.0.3 | Payload generates types from the collections, so the database shape and the code stay in sync. |
| Node.js | 24 LTS | 24.22.2 or later | `create-payload-app` and Payload 3.x require `>=24.22.1`. Older Node versions fail the install with an engine warning. |
| Package manager | pnpm | 10.34.7 | Reproducible installs from a lockfile. Strict about phantom dependencies, which catches import mistakes early. |
| Database | PostgreSQL on Neon | Postgres 18 (Neon) | Managed database, required by the brief. Free tier. Same engine locally (Neon dev branch) and in production. |
| DB adapter | `@payloadcms/db-postgres` | 3.93.0 | Official Payload adapter. Uses Drizzle under the hood and generates reviewable SQL migrations. |
| Object storage | Cloudflare R2 | (service) | S3-compatible, free tier of 10 GB, required by the brief. |
| Storage adapter | `@payloadcms/storage-s3` | 3.93.0 | Official Payload adapter for S3-compatible storage. The R2-specific adapter only runs on Cloudflare Workers, which this app does not use. |
| Image processing | sharp | 0.34.5 | Payload 3 uses it for thumbnails. Native binary, so it is listed in `onlyBuiltDependencies`. |
| Hosting | Render (Node web service) | (service) | Free tier, HTTPS, environment variables, builds Node directly without a Dockerfile. |
| Unit tests | Vitest | 5.0.1 | Runs TypeScript directly, fast, no build step. |
| Seed/scripts runner | tsx | 4.23.15 | Runs TypeScript scripts (the seed) without a build step. |

Not used, and why: Redis and any task queue (no background work in scope), Docker (Render builds Node directly, and local development uses a Neon branch), a separate REST API framework (Payload's REST API covers the data layer), GraphQL (not needed; the plugin is not installed).

---

## 4. Configuration files

### 4.1 `package.json`

**Scripts**

| Script | Command | What it does |
|---|---|---|
| `pnpm dev` | `next dev` | Starts the dev server with hot reload. Also rewrites `AGENTS.md` (generated by Next.js). |
| `pnpm build` | `next build` | Production build. Also type-checks the app. Needs the environment variables to be set. |
| `pnpm start` | `next start` | Serves the production build. Used by Render. |
| `pnpm payload` | `payload` | Payload CLI. Use it for `migrate`, `migrate:create`, and similar commands. |
| `pnpm generate:types` | `payload generate:types` | Regenerates `src/payload-types.ts` from the collections. Run after changing any field. |
| `pnpm generate:importmap` | `payload generate:importmap` | Regenerates `src/app/(payload)/admin/importMap.js`. Run after adding a custom admin component. |
| `pnpm seed` | `tsx src/seed/index.ts` | Fills the database with demo data. See [section 13](#13-seed-data). |
| `pnpm typecheck` | `tsc --noEmit` | Type-checks everything without emitting files. |
| `pnpm test` | `vitest run` | Runs the unit tests once. |

**Dependencies**

- Payload packages (`payload`, `@payloadcms/*`) are pinned to exact versions (`3.93.0`, no `^`). Payload packages must all use the same version. A mismatch causes runtime errors that are hard to trace. Upgrade them together.
- `next`, `react`, `react-dom` are pinned exactly for the same reason: Payload's admin depends on specific React and Next versions.
- `dotenv` loads `.env` for the seed script. `tsx` does not read `.env` by itself, and Next.js reads it on its own.
- `sharp` is a runtime dependency because Payload uses it for thumbnails.
- `@aws-sdk/client-s3` is pinned to `3.1165.0`, the same version `@payloadcms/storage-s3` uses. Two copies would bloat the install. The app uses it directly only in `src/lib/r2.ts`, to delete the folder of a rejected direct upload.
- Dev tooling (`typescript`, `vitest`, `tsx`, type packages) is in `devDependencies`.

**`engines`** documents the minimum Node version. pnpm prints a warning when the installed Node is too old.

**`pnpm.onlyBuiltDependencies`** allows install scripts for `sharp`, `esbuild`, and `unrs-resolver`. These packages download or compile native binaries. pnpm 10 blocks install scripts by default, so without this list `sharp` would not work.

**`packageManager`** pins the pnpm version. Tools like Corepack use it to pick the right pnpm.

### 4.2 `tsconfig.json`

- `strict: true` turns on all strict checks. Required for the type safety that Payload's generated types give us.
- `moduleResolution: bundler` and `module: esnext` match how Next.js and Payload resolve imports.
- `noEmit: true`. TypeScript only type-checks. Next.js compiles the code, and tsx runs scripts directly.
- `paths: { "@payload-config": ["./src/payload.config.ts"] }`. Next.js route files import the config with this alias.
- `include` covers `.next/types` so Next.js route types are checked.

We use relative imports inside `src/` (not `@/…`). Relative imports work the same in Next.js, tsx, and Vitest without extra configuration.

### 4.3 `next.config.ts`

```ts
export default withPayload(nextConfig, { devBundleServerPackages: false })
```

`withPayload` is Payload's Next.js wrapper. It sets up the Payload webpack/Turbopack integration and the server packages Payload needs. `devBundleServerPackages: false` keeps server-only packages external in development, which avoids bundling problems with Payload's Node-only code.

### 4.4 `vitest.config.mts`

Runs only `tests/unit/**/*.test.ts` in the Node environment. Integration and end-to-end tests are not set up yet ([section 14](#14-tests)).

### 4.5 `.gitignore`

| Entry | Why |
|---|---|
| `node_modules`, `.next`, `coverage`, `*.tsbuildinfo` | Build and install output. Regenerated on every machine. |
| `.env`, `.env.*` (except `.env.example`) | Real secrets. Must never be committed. |
| `next-env.d.ts` | Generated by Next.js on each run. |
| `.claude/launch.json` | Local Claude Code preview setting that points at a dev server you started yourself. Personal to each machine. |

Committed on purpose: `src/payload-types.ts`, `src/app/(payload)/admin/importMap.js`, and everything under `src/migrations/`. These are generated but must be reviewed and versioned, because they affect runtime behavior.

### 4.6 `.env.example`

A template with placeholder values. Copy it to `.env` and fill in real values. The real `.env` never goes into git. See [section 5](#5-environment-variables).

---

## 5. Environment variables

Every variable the app reads, where it is read, and what happens when it is missing.

| Variable | Read by | Purpose | If missing |
|---|---|---|---|
| `DATABASE_URL` | `src/lib/env.ts` → `payload.config.ts` | Neon Postgres connection string. Use the dev branch locally and the production branch on Render. | Startup throws `Missing required environment variable: DATABASE_URL`. |
| `PAYLOAD_SECRET` | `src/lib/env.ts` → `payload.config.ts` | Signs Payload sessions and tokens. Generate with `openssl rand -base64 48`. Changing it logs everyone out. | Startup throws. |
| `PAYLOAD_PUBLIC_SERVER_URL` | `src/lib/env.ts` → `payload.config.ts` | Public origin of the app, for example `http://localhost:3000` or the Render URL. Becomes `serverURL` and the only allowed `Origin` for cookie-authenticated requests (CSRF allowlist). Must start with `http://` or `https://`. Trailing slashes are removed. | Startup throws. |
| `R2_ACCOUNT_ID` | `src/lib/env.ts` → `payload.config.ts` | Cloudflare account ID. Builds the R2 endpoint `https://<id>.r2.cloudflarestorage.com`. | Startup throws. |
| `R2_BUCKET` | `src/lib/env.ts` → `payload.config.ts` | Name of the private R2 bucket that stores uploads. | Startup throws. |
| `R2_ACCESS_KEY_ID` | `src/lib/env.ts` → `payload.config.ts` | R2 API token access key. Token scope: Object Read and Write on this bucket only. | Startup throws. |
| `R2_SECRET_ACCESS_KEY` | `src/lib/env.ts` → `payload.config.ts` | R2 API token secret. | Startup throws. |
| `SEED_ADMIN_EMAIL` | `src/seed/options.ts` | Email of the admin account the seed creates. | Seed exits with an error. |
| `SEED_ADMIN_PASSWORD` | `src/seed/options.ts` | Password of that admin. Minimum 12 characters. | Seed exits with an error. |
| `SEED_AGENT_PASSWORD` | `src/seed/options.ts` | Password shared by the seeded agent accounts. Minimum 12 characters. | Seed exits with an error. |

**How the app fails.** `src/lib/env.ts` has one job: read a variable or throw. It never falls back to local disk, an embedded database, or a default password. A misconfigured deploy stops at startup with a message that names the missing variable.

**Where the values come from.**
- Locally: the `.env` file in the project root, which Next.js and `dotenv` read.
- On Render: the Environment tab of the web service. Render does not read `.env` files.

**Seed passwords.** They exist only in your local `.env`. They are not in code, not in the seed output, and not in git. The seed does not print them.

---

## 6. Runtime configuration: `payload.config.ts`

This file is the single source of runtime configuration. It is loaded by the admin, the REST API, the seed script, and the Payload CLI. Walkthrough, top to bottom:

| Option | Value | What it does and why |
|---|---|---|
| `admin.user` | `users` | The collection used for admin login. |
| `admin.importMap.baseDir` | `src/` | Where Payload finds custom admin components. Used when we add the bulk action and the AI widget. |
| `admin.meta.titleSuffix` | ` · Support` | Appears in the browser tab title. |
| `collections` | `[Users, Customers, Tags, Tickets, Media]` | Every collection the app manages. Order sets the sidebar order. |
| `editor` | `lexicalEditor()` | Rich text editor for `tickets.description`. Lexical is Payload's default editor. |
| `secret` | `env.payloadSecret()` | Read from the environment, never hardcoded. |
| `db` | `postgresAdapter({ pool, push: false })` | PostgreSQL through the connection string. `pool.keepAlive: true` keeps idle TCP connections alive. `push: false` means schema changes happen only through committed migrations (see [section 12](#12-database-and-migrations)). |
| `serverURL` | `env.serverUrl()` | The public origin of the app. Payload uses it for links and as the CSRF allowlist. |
| `csrf` | `[serverURL]` | Origins allowed to send cookie-authenticated requests. Payload rejects a cookie request whose `Origin` is not listed. We set it explicitly because Payload's default is an empty list, which turns the origin check off (see section 16). |
| `onInit` | attaches an `error` listener to `payload.db.pool` | Without a listener, an idle connection that fails in the background crashes the process. With it, the pool drops that connection and opens a new one on the next query. See [section 12.5](#125-connection-failures). |
| `upload.limits.fileSize` | `MAX_UPLOAD_BYTES` (5 MB) | Global upload size limit. The storage plugin checks it when it signs a direct-upload URL, so an oversized file never gets a URL. |
| `plugins` | `[s3Storage({...}), rememberOriginalNames]` | `s3Storage` stores the `media` collection's files in the R2 bucket. `clientUploads.access` limits direct-upload signing to staff (section 11.3). `rememberOriginalNames` (`src/plugins/`) wraps the signed-URL endpoint that `s3Storage` adds, so it must come after it. Startup fails if that endpoint is missing (section 11.3). |
| `sharp` | `sharp` | Image processing for thumbnails. |
| `typescript.outputFile` | `src/payload-types.ts` | Where the generated types are written. |

**Why `env` is called at module load.** `const r2 = env.r2()` runs when the config file loads. A missing variable fails before the server accepts a request.

**Why `push: false`.** Payload can sync the schema to the database automatically. That is convenient in development but can drop columns silently in production. We turn it off and use migrations, which are reviewed in git.

---

## 7. Data model

Source of truth: the collection files in `src/collections/`. Generated types: `src/payload-types.ts`.

### 7.1 Collections

| Collection | Key fields | Relations | Notes |
|---|---|---|---|
| `users` | `email`, `password` (hashed), `name`, `roles` (`admin`, `agent`, multi-select, no default) | none | Auth collection. Passwords are hashed by Payload (PBKDF2-SHA256 with a salt), never stored in plain text. Only staff roles can open the admin panel (`access.admin`). |
| `customers` | `name`, `email` (unique), `company` | none | The people who open tickets. They are not login users. |
| `tags` | `name` (unique, max 40), `color` (hex, validated) | none | Used for many-to-many labelling of tickets. |
| `tickets` | `subject` (5–200 chars), `description` (rich text), `status`, `priority`, `dueAt`, `resolvedAt`, `closedAt`, `isOverdue` (virtual), `comments` (array) | FK to `customers` (required), FK to `users` as `assignee`, many-to-many to `tags` | Core collection. Status workflow and due dates are enforced in a hook. |
| `media` | `alt`, file stored in a random UUID folder under the uploader's file name, `originalName` (read-only, the name the uploader gave), generated `thumbnail` | none | Uploads. Stored in R2. Limits in [section 11](#11-uploads-and-object-storage). |

### 7.2 Ticket fields in detail

- **`status`**: `new`, `in_progress`, `waiting_customer`, `resolved`, `closed`. Default `new`. Changes are checked by the workflow (section 8).
- **`priority`**: `low`, `normal`, `high`, `urgent`. Default `normal`. Sets the due date when the ticket is created.
- **`dueAt`**: read-only in the admin. Set once, on create, from priority.
- **`resolvedAt`, `closedAt`**: read-only. Set by the hook when the status enters `resolved` or `closed`.
- **`isOverdue`**: virtual (`virtual: true`). Not stored in the database. Computed on each read from `dueAt`, `status`, and the current time. Visible in the admin, but it cannot be used in a database filter.
- **`comments`**: array field, edited inline on the ticket. Each row: `body` (textarea, max 5000), `attachments` (up to 5 files from `media`), `author` (read-only, set by server), `createdAt` (read-only, set by server). See ADR-019.
- **`tags`**: relationship with `hasMany: true`. Stored in a join table (`tickets_rels`).

### 7.3 Why comments are inline rows

The brief asks for inline editing of a related model. Payload's array fields are the framework's native way to edit child rows inside a parent form. A separate `comments` collection would show comments as a read-only list in the ticket view. The trade-off: comments have no independent access rules. Anyone who can edit a ticket can edit its comments. See [ADR-019](architecture.md).

### 7.4 Indexes and constraints

- `users.email`, `customers.email`, `tags.name`: unique (Payload creates unique indexes).
- `tickets.subject`: length validated, 5–200 characters.
- `tags.color`: validated against `#rrggbb`.
- Foreign keys: Payload creates them for relationship fields in the migration.

---

## 8. Business logic: ticket workflow and due dates

### 8.1 Status workflow

Defined in one place: `src/lib/ticketStatus.ts`. Used by the `tickets` hook (`src/hooks/tickets.ts`) and by the bulk endpoint through the same hook.

| From | Allowed next statuses |
|---|---|
| `new` | `in_progress`, `closed` |
| `in_progress` | `waiting_customer`, `resolved` |
| `waiting_customer` | `in_progress`, `resolved` |
| `resolved` | `in_progress` (reopen), `closed` |
| `closed` | none (terminal) |

Guards on top of the transitions:
- Moving to `in_progress` requires an assignee. The check looks at the incoming `assignee` if the request sends one, and at the stored `assignee` otherwise. Clearing the assignee in the same request is handled.
- Setting the status to its current value is a no-op and always allowed.

Timestamps:
- Entering `resolved` sets `resolvedAt`.
- Entering `closed` sets `closedAt`.
- On create, if the ticket is created directly as `resolved` or `closed` (seed data does this), the matching timestamp is set too.

### 8.2 Why it is a hook

The hook (`beforeChange` on `tickets`) runs for every write: admin form, REST API, local API, the bulk endpoint, and the seed. A rule enforced only in the admin UI could be bypassed through the API. A rule in a hook cannot.

### 8.3 Due dates

Defined in `src/lib/dueDate.ts`.

| Priority | Window from creation |
|---|---|
| `urgent` | 4 hours |
| `high` | 24 hours |
| `normal` | 72 hours |
| `low` | 168 hours (7 days) |

- `computeDueAt(priority, createdAt)` sets `dueAt` on create only. Changing the priority later does not move the due date. This is a deliberate simplification.
- `isOverdue({ dueAt, status, now })` returns `true` when `now` is past `dueAt` and the status is neither `resolved` nor `closed`.
- There is no background job. Overdue is computed when a ticket is read, so there is no scheduler to run or monitor.

### 8.4 Why these rules are in `lib/` and not in the hooks

`validateStatusChange` and `isOverdue` are pure functions with no Payload import. Unit tests call them directly, with no database. The hook is a thin layer that connects them to Payload.

---

## 9. Roles and access control

### 9.1 Roles

| Role | Stored as | Who gets it |
|---|---|---|
| `admin` | `users.roles` contains `admin` | Full control. Manages users and tags, deletes tickets and customers. |
| `agent` | `users.roles` contains `agent` | Works on tickets. Cannot delete, cannot manage users or tags. Assigned by an admin. |

A user can hold both roles. Access checks use `hasRole`, which accepts any shape of `req.user` and returns `false` for anything malformed.

### 9.2 Matrix

| Collection | Operation | Admin | Agent | Anonymous |
|---|---|:-:|:-:|:-:|
| `tickets` | read | yes | yes | no |
| `tickets` | create | yes | yes | no |
| `tickets` | update | yes | yes (status changes follow the workflow) | no |
| `tickets` | delete | yes | no | no |
| `tickets.comments` | edit inline | yes | yes | no |
| `customers` | read, create, update | yes | yes | no |
| `customers` | delete | yes | no | no |
| `tags` | read | yes | yes | no |
| `tags` | create, update, delete | yes | no | no |
| `media` | read (file route) | yes | yes | no |
| `media` | create | yes | yes | no |
| `media` | update, delete | yes | no | no |
| `users` | read | yes | yes | no |
| `users` | create, update, delete | yes | no | no |
| `users.roles` | update | yes | no | no |
| `users` (admin sidebar) | visible | yes | hidden | hidden |
| Admin panel login | allowed | yes | yes | no (a user with no roles cannot open the admin) |

### 9.3 How it is enforced

- **Collection access functions**: each collection's `access` object calls `isAdmin` or `isStaff` (`src/lib/access.ts`). Payload runs these on every REST and local API call, not only in the admin UI.
- **Field access**: `users.roles` has its own `access.update: isAdmin`, so changing roles is restricted even inside an otherwise allowed update.
- **Admin panel login**: `users.access.admin` allows only staff roles. A user with no roles can exist (for example, a future OAuth sign-up) but cannot open the admin until an admin assigns a role.
- **Sidebar visibility**: `users` has `admin.hidden` that returns true for agents. This hides the section. It does not restrict access. The access functions do that.

A hidden button or hidden section is not a restriction on its own. Every restriction above is an access function, so it holds even if someone calls the API directly.

### 9.4 What is not covered

- Row-level rules (for example, "an agent sees only tickets assigned to them"). Not implemented. The access functions are at collection level.
- Customers have no login, so there is no customer role.
- **Agents can still read the users list through the API.** `users.access.read` allows any staff role, because the ticket view needs assignee names. The sidebar hides the section, but a direct REST call to `/api/users` returns the list to an agent. Restricting this without breaking assignee display needs field-level or query-level access, which is future work.

---

## 10. Bulk status endpoint

Route: `POST /api/tickets/bulk-status`. Defined in `src/collections/Tickets.ts` (endpoints) and implemented in `src/endpoints/bulkStatus.ts`.

**Request**

```json
{ "ids": [12, 15, 19], "status": "closed" }
```

**Response** (HTTP 200 even when some tickets fail, because the request itself was valid)

```json
{ "updated": 2, "failed": [{ "id": 15, "error": "Cannot change status from \"new\" to \"closed\"." }] }
```

**Status codes**

| Code | When |
|---|---|
| 200 | Request was valid. Per-ticket results are in the body. |
| 400 | Body is not JSON, `ids` is empty, longer than 500, or contains non-integers, or `status` is not a valid status. |
| 401 | No logged-in user. |
| 403 | Logged in but not staff. |

**How it works**

1. Checks the caller is logged in and is staff.
2. Validates the body: `ids` is 1 to 500 positive integers, `status` is one of the five values.
3. For each id, calls `payload.update` with `overrideAccess: false` and the caller's `req`. This means the normal access rules and the `beforeChange` workflow hook run for each ticket. The endpoint does not duplicate the rules.
4. Collects successes and failures. One invalid ticket does not stop the rest.

The admin UI button for this endpoint is not built yet (see [section 17](#17-known-limitations-and-next-steps)).

---

## 11. Uploads and object storage

### 11.1 Where files live

- **Bucket:** a private Cloudflare R2 bucket. Nothing is public. Files are not served by bucket URL.
- **Stored name:** `<uuid>/<client file name>`. Each upload gets its own random UUID folder, so two files with the same name never collide. Payload sanitizes the client's file name before it becomes the key (`browser test?.png` is stored as `browser test.png`). The name as the uploader picked it is kept in `originalName` for display, with only a client path, control characters, and outer spaces removed, capped at 200 characters (`src/lib/originalName.ts`). For direct uploads this needs an extra step, described in section 11.3. This replaces the earlier UUID file-name rule (see ADR-022 in the architecture doc).
- **Read path:** Payload's file route (`/api/media/file/<filename>`). It checks the `media` read access (staff only) before it streams the file. A logged-out visitor gets 403.
- **Write path:** the browser uploads straight to R2 with a signed URL, then creates the `media` document (section 11.3). The server reads the object back from R2 once, to validate it and to generate thumbnails with sharp. Thumbnails are uploaded to R2 too. Payload skips a thumbnail when the image is smaller than 240×240 in both width and height.
- **Delete path:** deleting a `media` document also removes its files from R2.

Using R2 means uploads survive a redeploy. Render's disk is ephemeral and would lose files.

### 11.2 Validation

Configured in `src/collections/Media.ts`. The hooks are in `src/hooks/media.ts` (`beforeMediaOperation`, `beforeMediaChange`), and the rules they call are in `src/lib/uploadRules.ts` and `src/lib/originalName.ts`.

| Rule | Where | Value |
|---|---|---|
| Allowed MIME types | `beforeOperation` hook (server) | `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, `text/plain` |
| Maximum size | `upload.limits.fileSize` (signed URL) and `beforeOperation` hook (server) | 5 MB (`MAX_UPLOAD_BYTES`). A declared size over the limit gets no URL. |
| Extension | `beforeOperation` hook (server) | Must match the MIME type (`.jpg` or `.jpeg`, `.png`, `.webp`, `.pdf`, `.txt`), case-insensitive |
| File signature | `beforeOperation` hook (server) | Magic bytes must match the MIME type. JPEG, PNG, WebP, and PDF have fixed signatures. Plain text must not contain NUL bytes. |
| Stored file name | Payload (plugin and file data) | `<uuid>/<sanitized client file name>`. See section 11.1. |
| Original name | `beforeOperation` and `beforeChange` hooks, `src/lib/originalName.ts` | Set by the server on create. Direct uploads take it from the signed-URL request (section 11.3). Server-side uploads take it from the uploaded file. |
| Error response | `beforeOperation` hook (server) | A failed check throws `APIError` with status 400. The reason (for example "File content does not match its type.") is the top-level `errors[0].message`, so the admin shows it in the toast. It is repeated in `errors[0].data.errors` with `path: "filename"`. |
| Remote URL fetch | `upload.pasteURL: false` | Disabled. The server never downloads a file from a URL the client sends. |
| Direct upload access | `clientUploads.access` | Staff only. Other users get no signed URL (403). |
| Generated thumbnails | `upload.imageSizes` | 240×240 centre crop for images. Skipped for images smaller than 240×240 in both dimensions. |

**Why the check is in a hook.** The `mimeTypes` option in Payload only filters the file picker in the browser. A request sent without the browser would skip it. The hook runs on the server for every create and update.

**Remaining limit.** The signature check reads only the first 16 bytes. A file with a valid PNG header followed by other content still passes. Plain text is the weakest type: any text passes unless it contains a NUL byte. Files are never served inline from a public URL (they go through the access-controlled route), so the risk stays limited. Re-encoding images would close the gap completely. It is not done.

### 11.3 Direct upload flow

The browser uploads straight to R2, so the file's bytes do not pass through the Render web service on the way in. This uses Payload's `clientUploads` option in `@payloadcms/storage-s3`.

1. The admin asks for a signed URL: `POST /api/storage-s3-generate-signed-url` with the collection, file name, MIME type, and size. Only staff get one. A size over 5 MB gets no URL.
2. The signed PUT URL expires after 600 seconds. It fixes the `Content-Type` and `Content-Length` headers, and R2 rejects a PUT whose headers differ.
3. The browser PUTs the file to R2 with those headers.
4. The browser creates the `media` document with a receipt the server signed (`clientUploadContext`). `requiresClientUploadReceipt: true` on `media` refuses a document without one.
5. Payload reads the object from R2 into a temp file, and the `beforeOperation` hook runs the checks in section 11.2. A failed check deletes the upload folder from R2 and returns 400 with the reason as the message.
6. On success, thumbnails are created and uploaded, and the document is saved.

**Keeping the original file name (ADR-023).** After step 1, Payload's browser handler replaces the file name with the sanitized one, so the document request in step 4 never carries the name the uploader picked. The signed-URL request is the only place the server sees it. `rememberOriginalNames` (`src/plugins/rememberOriginalNames.ts`) wraps that endpoint. The plugin's own checks run first and unchanged. When it returns a URL, the wrapper stores the cleaned name in Payload's key-value store (the `payload_kv` table, already in the initial migration) under `media-original-name:<upload folder UUID>`, with a 6-hour expiry that matches the receipt lifetime. In step 5 the hook reads the entry by the folder UUID from the signed receipt and deletes it, for a rejected upload too. The client cannot point at another upload's entry, because the folder UUID comes from the signed receipt. If the store fails, the upload still succeeds and `originalName` falls back to the sanitized name. A signed URL that is never used leaves its entry behind. The entry is small, and it is ignored after it expires. Nothing removes it yet.

**Why the server still reads the file.** The signed URL checks only the size and headers. It cannot see what the bytes are, so the server reads the file once after the upload. This is the trade-off recorded in ADR-022.

**R2 CORS.** The browser can PUT to R2 only if the bucket allows the app's origin. Set this once per bucket, with the S3 `PutBucketCors` call or the Cloudflare dashboard:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add the Render URL to `AllowedOrigins` before the first deploy. Without it, the admin upload fails with a CORS error. This setting is not in the repo.

### 11.4 Attachments on comments

A comment row can have up to 5 attachments (`maxRows: 5`). They reference `media` documents. Attachment permissions follow the `media` collection.

---

## 12. Database and migrations

### 12.1 Environments

| Environment | Database | How it is configured |
|---|---|---|
| Local development | Neon dev branch | `DATABASE_URL` in `.env` |
| Seed and tests | Neon dev branch | Same `.env` |
| Production (Render) | Neon production branch | `DATABASE_URL` in the Render dashboard |

A Neon branch is a copy-on-write copy of the database. Using a separate branch keeps local experiments away from production data.

### 12.2 Migration workflow

Schema changes follow the same steps every time:

1. Change a collection file in `src/collections/`.
2. Regenerate types: `pnpm generate:types`.
3. Create a migration: `pnpm payload migrate:create <name>`. This writes a `.ts` and a `.json` file into `src/migrations/`.
4. Review the generated SQL in the `.ts` file.
5. Apply it: `pnpm payload migrate`.
6. Commit the migration files, `payload-types.ts`, and the collection change together.

**Production** runs `pnpm payload migrate` before starting the app. It never uses `push`, because `push: false` is set in the config.

### 12.3 Migration history so far

- `20261110_152856_initial`: creates all tables for the five collections, Payload's own tables (`payload_migrations`, `payload_kv`, `payload_locked_documents`, `payload_preferences`), and the join tables for tags and roles.
- `20261110_165322_media_original_name_roles`: adds `media.original_name`. The column already existed on the dev branch because of an earlier dev-mode sync, so the statement is `ADD COLUMN IF NOT EXISTS`. The roles change needs no SQL, because roles live in a join table.

**Dev-mode marker.** If a database was ever synced in dev mode, Payload writes a row named `dev` with `batch = -1` into `payload_migrations`. From then on `pnpm payload migrate` asks "data loss will occur, proceed?" before it runs. That row must never exist in the production database. Production should only ever get migrations. The dev branch still has the row, so answer the prompt after checking `pnpm payload migrate:status`.

### 12.5 Connection failures

Neon is a remote database. Connections can time out, and an idle pooled connection can fail in the background.

- **Background failures on idle connections:** `onInit` in `payload.config.ts` attaches an `error` listener to the pool. The failure is logged, the pool discards the connection, and the next query opens a new one. Without this listener the process crashes. This was observed during the first full seed run: a `read ETIMEDOUT` on an idle connection killed the process after about 6,800 tickets.
- **Keep-alive:** `pool.keepAlive: true` sends TCP keep-alive packets, so the network does not silently drop an idle connection.
- **Retries in the seed:** each create and update is retried up to three times on transient network errors (`ETIMEDOUT`, `ECONNRESET`, `EPIPE`, and similar). Other errors fail immediately.
- **Known trade-off:** a retried create can duplicate a ticket if the database committed the first attempt but the response was lost. This is rare. The ticket count after a run shows whether it happened.

The app itself does not retry requests. A failed request returns an error to the user, and the user retries.

### 12.4 Reset behavior

`pnpm seed --reset` does not drop tables. It deletes rows. Media is deleted through Payload so its R2 files are removed too. Everything else is deleted with the database-level `payload.db.deleteMany`, which skips per-document hooks and is much faster than deleting document by document. Table structure is untouched, so migrations stay valid.

---

## 13. Seed data

### 13.1 Running it

```bash
pnpm seed                  # fills an empty database; refuses if tickets already exist
pnpm seed --reset          # deletes all data first, then seeds again
pnpm seed --tickets=500    # smaller run (default is 2000)
```

Requirements: `DATABASE_URL`, `PAYLOAD_SECRET`, the R2 variables, and the three `SEED_*` variables in `.env`.

**Safety rules**
- `--reset` refuses to run when `NODE_ENV=production`.
- Without `--reset`, the seed refuses to run if tickets already exist.
- Passwords are read from the environment and must be at least 12 characters.

### 13.2 What it creates

| Item | Count | Notes |
|---|---|---|
| Admin | 1 | Email from `SEED_ADMIN_EMAIL`, role `admin` |
| Agents | 8 | Fixed names, emails under `support.example.test`, role `agent`, password from `SEED_AGENT_PASSWORD` |
| Customers | 2,000 | Unique emails under `customers.example.test` |
| Tags | 30 | Names like `billing`, `sso`, `outage`, each with a colour |
| Media | 100 | 60 generated PNG screenshots, 40 text logs. Stored in R2 |
| Tickets | 2,000 by default | Random subjects, statuses, priorities, tags, comments, attachments |

### 13.3 How the data is generated

- **Deterministic.** A seeded pseudo-random generator (`src/seed/random.ts`, mulberry32) with a fixed seed. The same run produces the same data. A bug on seeded data is reproducible.
- **Weighted.** Priorities: low 15, normal 50, high 25, urgent 10 (relative weights). Statuses: new 20, in progress 25, waiting for customer 15, resolved 20, closed 20.
- **Consistent with the workflow.** Any status other than `new` gets an assignee. Creating a ticket directly in `resolved` or `closed` sets the matching timestamp.
- **Some overdue tickets.** About 30% of open tickets get a due date between 1 and 30 days in the past, so the overdue state has real examples. This is done with one extra update per ticket after creation.
- **Comments.** 0 to 5 per ticket. About 8% have an attachment.

### 13.4 Known simplifications

- All tickets are created within a few minutes of each other, so `createdAt` is nearly the same for all of them. Date-range filters will look flat.
- Statuses are set at creation, so the seed does not replay the workflow history.
- Comment authors are set explicitly in the seed. The hook uses them, because there is no logged-in user during the seed.

### 13.5 Speed and reliability

Each record is created through Payload's local API, so hooks, access checks, and storage run as they do for real users. This is slower than a bulk SQL insert, and that trade-off is intentional. Each create makes several round trips to Neon, which runs in a different region from the development machine. Writes are done in parallel batches of 10.

Measured on the Neon dev branch from a developer laptop (`pnpm seed --reset --tickets=500`):

| Step | Time |
|---|---|
| Reset | under 1 s |
| Staff (1 admin, 8 agents) | 2 s |
| Customers (2,000) | about 50 s |
| Tags (30) | 4 s |
| Media (100 files, thumbnails) | about 15 s |
| Tickets (500) | about 41 s, about 80 ms per ticket with 10 in parallel |

At that rate the default run (2,000 tickets) took 233 seconds (about 4 minutes) on the Neon dev branch. Most of the time is network latency to Neon, not CPU. Raising the parallelism is possible but limited by the connection pool.

---

## 14. Tests

### 14.1 What exists

Unit tests in `tests/unit/`, run with `pnpm test`:

| File | Covers |
|---|---|
| `ticketStatus.test.ts` | Every allowed transition, a set of rejected transitions, the closed terminal state, the assignee guard, same-status no-op, status validation |
| `dueDate.test.ts` | The four SLA windows, overdue before and after the due time, resolved and closed never overdue, missing due date, ISO string input |
| `access.test.ts` | `hasRole` with valid and malformed users, `isAdmin`, `isStaff` for admin, agent, both, anonymous |
| `uploadRules.test.ts` | Magic bytes for each allowed type, HTML sent as an image, a header that is too short, NUL bytes in text, extension match and mismatch, the 5 MB boundary, and the order of the checks |
| `mediaHooks.test.ts` | The `media` hooks with a fake request (Map-backed key-value store, logger) and a mocked `deleteFolder`: which operations are checked, each rejection reason as the 400 message with `path: "filename"`, the size read from the temp file and not the declared size, R2 folder cleanup with and without a prefix, a failed cleanup still returning the validation error, the stored name taken and deleted (also on rejection and when expired), fallbacks when nothing is stored or the store fails, and `originalName` set only on create |
| `rememberOriginalNames.test.ts` | The signed-URL wrapper with a fake plugin handler and a fake key-value store: the name is stored under the signed folder, the body is read once and handed on, the response stays readable, nothing is stored on a refused request or without a name or folder, a store failure does not fail the upload, and startup fails without the plugin endpoint |
| `originalName.test.ts` | Original-name cleaning (characters the key loses are kept, client paths and control characters removed, length cap, empty input), the store key, and reading a stored name back (fresh, expired, malformed) |

None of them needs a database or R2, so the whole suite runs in under a second (most of it is importing Payload for the hook tests).

### 14.2 What is not tested yet

- **Hooks against a real database**: the `beforeTicketChange` hook (timestamps, comment authorship) and the transition enforcement on real writes.
- **Access rules end to end**: the agent gets 403 on delete, the admin gets 200.
- **Bulk endpoint**: partial failures, 400 and 401 and 403 responses.
- **Uploads against real services**: the `media` hooks and the signed-URL wrapper are unit tested with fakes (section 14.1). Not covered by tests: `deleteFolder` against R2 (listing and batch delete), the real `payload_kv` table, and Payload passing the receipt and temp file to the hook. These are checked by a live script that is not in the repo and by hand in the admin.
- **Admin UI**: login, list filters, inline comments.
- **Roles through the API**: an agent gets 403 on delete, a no-role user cannot log in to the admin, and the CSRF origin check rejects foreign origins.

Planned: integration tests with Vitest against a Neon test branch, and a few Playwright end-to-end tests for the admin. Both are listed in [section 17](#17-known-limitations-and-next-steps).

---

## 15. Commands

| Task | Command |
|---|---|
| Install dependencies | `pnpm install` |
| Start dev server | `pnpm dev` (opens on port 3000 by default) |
| Apply migrations | `pnpm payload migrate` |
| Create a migration | `pnpm payload migrate:create <name>` |
| Migration status | `pnpm payload migrate:status` |
| Regenerate types | `pnpm generate:types` |
| Regenerate admin import map | `pnpm generate:importmap` |
| Seed demo data | `pnpm seed` |
| Reset and seed | `pnpm seed --reset` |
| Unit tests | `pnpm test` |
| Type check | `pnpm typecheck` |
| Production build | `pnpm build` |
| Run production build | `pnpm start` |

If a command fails with `Missing required environment variable`, the `.env` file is missing or incomplete. See [section 5](#5-environment-variables).

---

## 16. Security notes

| Area | What is in place | Status |
|---|---|---|
| Passwords | Hashed by Payload with PBKDF2-SHA256, 600,000 iterations, and a random salt (`generatePasswordSaltHash` in Payload 3.93). Not bcrypt. Never stored in plain text. | In place |
| Sessions | Signed with `PAYLOAD_SECRET`. Stored in `users_sessions`. Cookies use Payload's default `SameSite=Lax`. | In place |
| Secrets in git | `.env` is ignored. Only `.env.example` with placeholders is committed. | In place |
| Access control | Every collection has access functions, enforced on REST and local API calls. | In place |
| Anonymous access | Anonymous requests to tickets return 403. The bulk endpoint returns 401. | Verified against the running dev server |
| Upload types, size, and content | Checked on the server: MIME allowlist, 5 MB, extension, magic bytes (section 11.2). | In place |
| Remote URL fetch | Disabled (`pasteURL: false`). Prevents server-side request forgery. | In place |
| File reads | Through the access-controlled route. The bucket is private. | In place |
| Direct upload access | Only staff get a signed R2 upload URL. A document needs a receipt the server signed (section 11.3). | In place |
| R2 CORS | `PUT` allowed only from the app origin. The Render origin must be added before deploy (section 11.3). | In place for dev; Render pending |
| Default privileges | New accounts have no roles and no admin access. | In place |
| Admin login | Only staff roles can open the admin panel. | In place |
| CSRF | Cookie requests are checked against the `csrf` allowlist, set to `[PAYLOAD_PUBLIC_SERVER_URL]`. Payload 3.93 treats a cookie request with a foreign `Origin` as anonymous. Cookies are `SameSite=Lax`, which also blocks cross-site form posts in modern browsers. A request with no `Origin` header falls back to `Sec-Fetch-Site`: `same-origin`, `same-site`, and `none` are accepted, and anything else is anonymous. Verified in Payload source. | In place |
| Rate limiting | Not implemented. Login brute-force protection is not configured. | Known gap |
| Security headers | Not configured. | Known gap |

---

## 17. Known limitations and next steps

### Limitations accepted for this project

- Row-level permissions are not implemented (agents see all tickets).
- Priority changes do not move the due date (the due date is set on create only).
- Overdue is not filterable in the database, because it is computed on read.
- Comments have no separate edit rights.
- Seed tickets share a creation time within minutes.
- No email notifications and no SLA escalation. Both need background jobs, which are out of scope.
- The admin's browser upload path is checked by hand, not by an automated end-to-end test.
- An unused signed upload URL leaves a small expired entry in `payload_kv` (section 11.3).

### Planned next steps (in order)

1. Apply migrations and seed the Neon dev branch. Done: the default 2,000-ticket seed took about 4 minutes.
2. Admin UI: bulk status action on the tickets list (custom component that calls the endpoint).
3. Integration tests for hooks, access rules, the bulk endpoint, and upload validation.
4. Admin customizations: list filters and search are configured in the collections. Verify them in the browser.
5. AI help chat (Groq, free tier) as a custom admin component, grounded in field descriptions.
6. README for the project: setup, architecture summary, what was skipped and why.
7. Deploy to Render: build and start commands, environment variables, first migration, smoke test.
8. Login rate limiting and security headers. The magic-byte check is done (section 11.2).
9. OAuth (GitHub) later, after the core is complete.

### Open verification items

- Confirmed: after `pnpm seed --reset` on the Neon dev branch, no orphaned comment rows or tag-join rows remain. Child rows are removed through the foreign-key cascade.
- Done: the default 2,000-ticket seed took 233 seconds. Recorded in section 13.5.
- Done: direct upload checked against the dev server with a live script that is not in the repo. It covers signing, the PUT to R2, the receipt, validation, the thumbnail, cleanup, and access. 15 of 15 checks pass.
- Done: the upload checked in the admin in a browser against the dev server. A valid PNG goes straight to R2 and gets a thumbnail. `originalName` keeps characters the key loses (`Отчёт #3 (финал)?.png`). A text file named `.png` is refused with "File content does not match its type." in the toast, its R2 folder is emptied, and no `payload_kv` entry is left.
