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
18. [Deployment on Render](#18-deployment-on-render)

---

## 1. What the app does

A support team uses an admin panel to track customer tickets. Staff (admins and agents) create tickets for customers, assign them to agents, move them through a status workflow, add comments with attachments, tag them, and bulk-update their status. Admins also manage staff accounts and tags. Agents cannot delete records or manage users.

The app is built on **Payload CMS 3**. Payload generates the admin UI from TypeScript collection configs, so the admin is the framework's own tooling and not a hand-built UI. Custom code covers only the business rules, the access rules, the upload checks, the bulk status endpoint with its admin bar (the one custom admin component), and the deploy scripts (migrations before start, R2 CORS).

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
│   │   └── (frontend)/          Root URL (redirects to /admin) and /healthz for Render
│   ├── collections/             One file per collection: fields, access, admin options
│   ├── components/              Custom admin components (bulk status bar on the tickets list)
│   ├── endpoints/               Custom REST endpoints (bulk status)
│   ├── hooks/                   Collection hooks that run on every write: ticket workflow, media checks, user creation guard
│   ├── lib/                     Pure logic with no Payload import: workflow, due dates, roles, env, upload rules, bulk batching, CORS rule, migration guard
│   ├── migrations/              Committed database migrations (generated, never hand-edited)
│   ├── plugins/                 Small config plugins (keeps the uploader's file name on direct uploads)
│   ├── scripts/                 One-off operations: migrate before start, set R2 CORS
│   ├── seed/                    Demo data generator (pnpm seed)
│   ├── payload.config.ts        Payload runtime configuration (the central file)
│   └── payload-types.ts         TypeScript types generated from the collections (committed)
├── tests/unit/                  Vitest unit tests for lib/ logic
├── package.json                 Scripts, dependencies, pnpm settings
├── pnpm-lock.yaml               Exact dependency versions (commit this)
├── tsconfig.json                TypeScript settings
├── next.config.ts               Next.js settings, wrapped with Payload
├── render.yaml                  Render Blueprint: build, start, health check, env var names
├── .node-version                Exact Node version for Render and local tools
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
| Node.js | 24 LTS | 24.22.2 (`.node-version`), range `>=24.22.1 <25` | `create-payload-app` and Payload 3.x require `>=24.22.1`. Older Node versions fail the install with an engine warning. The upper bound keeps Render on Node 24 (section 4.1). |
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
| `pnpm start` | `next start` | Serves the production build without migrating. For a local check of a build. |
| `pnpm start:prod` | `pnpm migrate && next start` | Render's start command. Migrates, then serves. A failed migration stops the start. See [section 18](#18-deployment-on-render). |
| `pnpm migrate` | `tsx src/scripts/migrate.ts` | Runs pending migrations. Unlike `payload migrate`, it stops with exit code 1 on a dev-mode push instead of prompting ([section 12.2](#122-migration-workflow)). |
| `pnpm r2:cors` | `tsx src/scripts/setR2Cors.ts` | Sets the R2 bucket's CORS rule to the origins given as arguments. `--dry-run` prints it only ([section 11.3](#113-direct-upload-flow)). |
| `pnpm payload` | `payload` | Payload CLI. Use it for `migrate:create`, `migrate:status`, and similar commands. |
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

**`engines`** is `>=24.22.1 <25`. pnpm prints a warning when the installed Node is outside it. The upper bound matters on Render: an open range such as `>=24.22.1` resolves to the newest Node release, which would switch major versions without a code change. The exact version Render installs comes from `.node-version` (section 4.7).

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

### 4.7 `.node-version`

One line: `24.22.2`. Render reads it to install that exact Node version, and nvm-style tools read it locally. Render's precedence is the `NODE_VERSION` variable, then `.node-version`, then `.nvmrc`, then `engines`. Do not set `NODE_VERSION` on Render, so this file stays the single source.

### 4.8 `render.yaml`

The Render Blueprint: the web service as code. Every setting the dashboard would hold, except secret values.

| Key | Value | Why |
|---|---|---|
| `runtime`, `plan`, `region` | `node`, `free`, `frankfurt` | Free Node service in the same region as the Neon database (`eu-central-1`), so each query stays inside Frankfurt. |
| `buildCommand` | `corepack enable && pnpm install --frozen-lockfile && pnpm build` | Corepack installs the pnpm version from `packageManager`. `--frozen-lockfile` fails the build if `pnpm-lock.yaml` is out of date, instead of resolving new versions on the server. |
| `startCommand` | `pnpm start:prod` | Migrates, then starts. Free services have no pre-deploy command. |
| `healthCheckPath` | `/healthz` | Render switches traffic to a new deploy only after this answers 200. |
| `envVars` | `PAYLOAD_SECRET` generated, others `sync: false` | Render generates the secret once. The other values are entered in the dashboard and never stored in git. |
| `COREPACK_ENABLE_DOWNLOAD_PROMPT` | `0` | Stops Corepack from asking before it downloads pnpm, which would hang a build with no terminal. |

`NODE_ENV` is not set on purpose. With `NODE_ENV=production`, `pnpm install` skips `devDependencies`, and the build needs TypeScript and the type packages. `next build` and `next start` set `NODE_ENV=production` for the app themselves.

---

## 5. Environment variables

Every variable the app reads, where it is read, and what happens when it is missing.

| Variable | Read by | Purpose | If missing |
|---|---|---|---|
| `DATABASE_URL` | `src/lib/env.ts` → `payload.config.ts` | Neon Postgres connection string. Use the dev branch locally and the production branch on Render. | Startup throws `Missing required environment variable: DATABASE_URL`. |
| `PAYLOAD_SECRET` | `src/lib/env.ts` → `payload.config.ts` | Signs Payload sessions and tokens. Generate with `openssl rand -base64 48`. Changing it logs everyone out. | Startup throws. |
| `PAYLOAD_PUBLIC_SERVER_URL` | `src/lib/env.ts` → `payload.config.ts` | Public origin of the app, for example `http://localhost:3000` or the Render URL. Becomes `serverURL` and the only allowed `Origin` for cookie-authenticated requests (CSRF allowlist). Must be an origin only: `http://` or `https://`, host, optional port, no path or query. A trailing slash is removed. With `NODE_ENV=production` it must be `https://`, except for `localhost`, `127.0.0.1`, and `[::1]`. An `https://` value also turns on the `Secure` flag of the session cookie. | Startup throws. A wrong value also throws, with the reason. |
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
| `onInit` | attaches an `error` listener to `payload.db.pool` | Without a listener, an idle connection that fails in the background crashes the process. With it, the pool drops that connection and opens a new one on the next query. See [section 12.4](#124-connection-failures). |
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
| `users` | `email`, `password` (hashed), `name`, `roles` (`admin`, `agent`, multi-select, no default) | none | Auth collection. Passwords are hashed by Payload (PBKDF2-SHA256 with a salt), never stored in plain text. Only staff roles can open the admin panel (`access.admin`). Only admins and the seed can create users, including through Payload's first-user registration (section 16). |
| `customers` | `name`, `email` (unique), `company` | none | The people who open tickets. They are not login users. |
| `tags` | `name` (unique, max 40), `color` (hex, validated) | none | Used for many-to-many labelling of tickets. |
| `tickets` | `subject` (5–200 chars), `description` (rich text), `status`, `priority`, `dueAt`, `resolvedAt`, `closedAt`, `isOverdue` (virtual), `comments` (array) | FK to `customers` (required), FK to `users` as `assignee`, many-to-many to `tags` | Core collection. Status workflow (including the status a ticket starts in) and due dates are enforced in a hook. |
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
- **Creating a ticket counts as a move out of `new`** (`validateInitialStatus`). A ticket can be created as `new`, or one allowed step from it: `in_progress` with an assignee, or `closed` (spam, a duplicate). Creating it as `waiting_customer` or `resolved` is refused with "A new ticket cannot start as …". Before this rule the checks ran on updates only, so a ticket could be created directly as `in_progress` without an assignee, or as `resolved`. Duplicating a resolved ticket in the admin is refused for the same reason: set the copy to New first.

Timestamps:
- Entering `resolved` sets `resolvedAt`.
- Entering `closed` sets `closedAt`.
- A ticket created as `closed` gets `closedAt` on create.

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
- **Field access**: `users.roles` has its own `access.create: isAdmin` and `access.update: isAdmin`, so setting roles is restricted even inside an otherwise allowed create or update.
- **User creation guard**: Payload's first-user registration runs with `overrideAccess: true` and skips the access functions. The `users` `beforeOperation` hook (`src/hooks/users.ts`) refuses every create that is not from an admin or from the local API (the seed).
- **Admin panel login**: `users.access.admin` allows only staff roles. A user with no roles can exist (for example, a future OAuth sign-up) but cannot open the admin until an admin assigns a role.
- **Sidebar visibility**: `users` has `admin.hidden` that returns true for agents. This hides the section. It does not restrict access. The access functions do that.

A hidden button or hidden section is not a restriction on its own. Every restriction above is an access function, so it holds even if someone calls the API directly.

### 9.4 What an agent sees (checked on production)

Logged in as a seeded agent on Render, 2026-11-11:

| Place | What the agent sees |
|---|---|
| Sidebar | Customers, Tags, Tickets, Media. No Users. `/admin/collections/users` is a 404 |
| Tickets and Customers lists | Selecting rows offers "Edit" and the bulk status bar. No bulk "Delete" |
| Ticket edit view | No delete action |
| Media edit view | No "Save", so the fields cannot change. "Duplicate" is offered, because creating media is allowed. "Edit Image" opens, but its result cannot be saved |
| Tag edit view | No "Save" and no delete. Tags are read-only for agents |
| API, the same calls an admin makes | Create user, promote itself, delete a ticket, change media: 403 each |

Payload hides these controls from the access results, so the admin shows the same limits that the access functions enforce.

### 9.5 What is not covered

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
{ "updated": 2, "failed": [{ "id": 15, "error": "Cannot change status from \"Closed\" to \"New\"." }] }
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

### 10.1 The bulk status bar in the admin

`src/components/BulkStatusBar.tsx`, registered as `admin.components.beforeListTable` on `tickets` (see `importMap.js`). It is the only custom admin component so far.

**What the user sees.** Select rows in the tickets list, and a bar appears above the table: "Change status of N selected tickets to [status] Apply". After a confirmation dialog the bar shows progress ("Updating 200 / 500…"), then a toast with the outcome. Tickets that did not move stay listed under the bar, grouped by reason, each linked to the ticket by its subject. The list reloads with the new statuses and the selection is cleared.

**How it works.**

1. **Collect ids.** For rows picked on the page, the ids come from Payload's selection. For "Select all (N)" across pages, Payload selects the query, not ids, so the bar asks the API for the ids of that query (`select[id]=true`, up to 501). Payload's query helper drops the list's search box, so `searchFilter` in `src/lib/bulkStatusBatches.ts` adds the same `subject like` filter back. More than 500 matching tickets are refused with a hint to narrow the list.
2. **Send in batches of 100** to `POST /api/tickets/bulk-status`. Batches show progress, and no single request runs long on the free instance (500 tickets is five requests).
3. **Merge the results.** A batch the server refused as a whole (network error, 401, 403) counts as failed for each of its tickets, so the summary accounts for every one.
4. **Show failures.** The subjects of failed tickets are loaded in one request. The last result is kept outside the component, because the list re-mounts it when it reloads.

**What it does not do.** It holds no workflow rules. It does not hide target statuses a ticket cannot reach: the endpoint runs `src/lib/ticketStatus.ts` for every ticket and reports the refusals, which the bar displays. Agents and admins both see it, because both may change statuses. A user without a staff role never reaches the admin.

**Checked in the admin (dev server).** Three tickets to "In progress": the waiting one moved, the one without an assignee and the closed one stayed, with their reasons. "Select all" with the search "SSO" across 2-row pages: the id query carried `subject like SSO`, 4 of 5 moved to Closed, the in-progress one was refused, and no ticket outside the search changed.

**Checked on production (Render, build from `1b729cb`), logged in as an agent.** A waiting ticket and a closed one to "In progress": the waiting one moved, the closed one was refused with "Cannot change status from \"Closed\" to \"In progress\"." and a link by subject, and the selection was cleared. The waiting ticket was then moved back to "Waiting for customer" with the same bar, so the data is as it was.

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

**R2 CORS.** The browser can PUT to R2 only if the bucket allows the app's origin. The rule lives in the repo (`src/lib/r2Cors.ts`) and is applied with a script:

```bash
pnpm r2:cors https://<app>.onrender.com http://localhost:3000
```

It replaces the bucket's whole CORS config with one rule. Pass every origin the admin runs on, or the ones left out stop working. `--dry-run` prints the current and the new rule without changing anything. The R2 token in `.env` needs permission to change bucket settings. The rule it writes:

```json
[
  {
    "AllowedOrigins": ["https://<app>.onrender.com", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-length", "if-none-match"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- Only `PUT`. Reads go through Payload's file route on the app's own origin, so no browser ever reads the bucket directly.
- Only the three headers the signed PUT sends, not `*`. Checked in the admin: an upload from `http://localhost:3000` passes with this rule.
- Origins are checked before anything is sent: no `*`, no paths.

Run it with the Render URL before the first upload on Render. Without it, the admin upload fails with a CORS error in the browser console.

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
5. Apply it: `pnpm migrate`.
6. Commit the migration files, `payload-types.ts`, and the collection change together.

**Production** runs `pnpm migrate` before starting the app (`pnpm start:prod`). It never uses `push`, because `push: false` is set in the config.

**Why `pnpm migrate` and not `payload migrate`.** `src/scripts/migrate.ts` runs the same adapter migration with one check in front (`src/lib/migrationGuard.ts`). If `payload_migrations` holds the dev-mode marker (batch -1, see section 12.3), `payload migrate` prompts "data loss will occur, proceed?". With no terminal it waits forever, which was reproduced against the dev branch. A cancelled prompt calls `process.exit(0)`, so `payload migrate && next start` would start the server on a schema that was never migrated. `pnpm migrate` stops with exit code 1 and a message that says what to do. Any migration error also exits 1, so `next start` never runs and Render keeps the previous deploy.

### 12.3 Migration history so far

- `20261110_152856_initial`: creates all tables for the five collections, Payload's own tables (`payload_migrations`, `payload_kv`, `payload_locked_documents`, `payload_preferences`), and the join tables for tags and roles.
- `20261110_165322_media_original_name_roles`: adds `media.original_name`. The column already existed on the dev branch because of an earlier dev-mode sync, so the statement is `ADD COLUMN IF NOT EXISTS`. The roles change needs no SQL, because roles live in a join table.

**Dev-mode marker.** If a database was ever synced in dev mode, Payload writes a row named `dev` with `batch = -1` into `payload_migrations`. From then on `pnpm payload migrate` asks "data loss will occur, proceed?" before it runs. That row must never exist in the production database. Production should only ever get migrations, so never run `pnpm dev` with the production `DATABASE_URL`. The dev branch still has the row (written at 15:29 UTC and last updated at 16:54 UTC on 2026-11-10, by a dev server still running a config from before `push: false`). So `pnpm migrate` refuses to run on the dev branch until the row is checked and deleted.

**Recovering from the marker.** Run `pnpm payload migrate:status` and compare the tables with the committed migrations. If every migration is applied and the schema matches, delete the row (`DELETE FROM payload_migrations WHERE name = 'dev' AND batch = -1`) and run `pnpm migrate` again. If the schema has changes no migration covers, write a migration for them first.

### 12.4 Connection failures

Neon is a remote database. Connections can time out, and an idle pooled connection can fail in the background.

- **Background failures on idle connections:** `onInit` in `payload.config.ts` attaches an `error` listener to the pool. The failure is logged, the pool discards the connection, and the next query opens a new one. Without this listener the process crashes. This was observed during the first full seed run: a `read ETIMEDOUT` on an idle connection killed the process after about 6,800 tickets.
- **Keep-alive:** `pool.keepAlive: true` sends TCP keep-alive packets, so the network does not silently drop an idle connection.
- **Retries in the seed:** each create and update is retried up to three times on transient network errors (`ETIMEDOUT`, `ECONNRESET`, `EPIPE`, and similar). Other errors fail immediately.
- **Known trade-off:** a retried create can duplicate a ticket if the database committed the first attempt but the response was lost. This is rare. The ticket count after a run shows whether it happened.

The app itself does not retry requests. A failed request returns an error to the user, and the user retries.

### 12.5 Reset behavior

`pnpm seed --reset` does not drop tables. It deletes rows. Media is deleted through Payload so its R2 files are removed too. Everything else is deleted with the database-level `payload.db.deleteMany`, which skips per-document hooks and is much faster than deleting document by document. Table structure is untouched, so migrations stay valid.

---

## 13. Seed data

### 13.1 Running it

```bash
pnpm seed                  # fills an empty database; refuses if tickets already exist
pnpm seed --reset          # deletes all data first, then seeds again
pnpm seed --tickets=500    # smaller run (default is 2000)
```

Requirements: `DATABASE_URL`, `PAYLOAD_SECRET`, `PAYLOAD_PUBLIC_SERVER_URL`, the R2 variables, and the three `SEED_*` variables in `.env`. The seed loads the full Payload config, so it needs every variable the app needs. Seeding production is described in [section 18.3](#183-first-deploy-step-by-step).

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
- **Through the workflow.** Any status other than `new` gets an assignee. Each ticket is created at the first step of the shortest allowed path from `new` (`statusPath` in `src/lib/ticketStatus.ts`), then moved one step at a time, so the tickets hook checks every step and sets the timestamps. `waiting_customer` and `resolved` tickets take one extra update (via `in_progress`).
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
| `ticketStatus.test.ts` | Every allowed transition, a set of rejected transitions, the closed terminal state, the assignee guard, same-status no-op, status validation, which statuses a new ticket may start in, and the shortest path between statuses (every step allowed, every status reachable from New) |
| `ticketsHook.test.ts` | The tickets hook with a fake request: the create rule (start statuses, assignee guard, due date, `closedAt`), the update rule (allowed and refused steps, assignee being saved versus stored), and server-set comment author and time |
| `dueDate.test.ts` | The four SLA windows, overdue before and after the due time, resolved and closed never overdue, missing due date, ISO string input |
| `access.test.ts` | `hasRole` with valid and malformed users, `isAdmin`, `isStaff` for admin, agent, both, anonymous |
| `uploadRules.test.ts` | Magic bytes for each allowed type, HTML sent as an image, a header that is too short, NUL bytes in text, extension match and mismatch, the 5 MB boundary, and the order of the checks |
| `env.test.ts` | Required variables (missing and blank), the server origin (bare origin only, no path or login, https in production except local hosts), and the cookie `Secure` switch |
| `migrationGuard.test.ts` | The dev-push check: batch `-1` as a string (how Postgres returns it) and as a number, a migrated database, a fresh one, and the recovery message |
| `r2Cors.test.ts` | The CORS rule: origin parsing, no `*`, no paths, duplicates removed, only `PUT` and the three signed headers |
| `healthz.test.ts` | `/healthz` answers 200 with `no-store` and is never prerendered |
| `usersHook.test.ts` | Who may create a user: admin over any API, the seed over the local API, nobody else. The users hook refuses the public first-user registration and agents, and leaves other operations to the access functions |
| `bulkStatusEndpoint.test.ts` | The bulk endpoint with a fake request: 401 and 403, every 400 case including the 500 limit, each ticket updated with `overrideAccess: false` and the caller's `req`, refused transitions reported per ticket while the rest update, and other errors reported as "Update failed" without details |
| `bulkStatusBatches.test.ts` | The bulk bar's plumbing: id cleanup, batches of 100 (500 becomes five requests), reading the endpoint response including whole-batch failures, merging, the toast summary, grouping failures by reason, and the search filter for "select all" |
| `mediaHooks.test.ts` | The `media` hooks with a fake request (Map-backed key-value store, logger) and a mocked `deleteFolder`: which operations are checked, each rejection reason as the 400 message with `path: "filename"`, the size read from the temp file and not the declared size, R2 folder cleanup with and without a prefix, a failed cleanup still returning the validation error, the stored name taken and deleted (also on rejection and when expired), fallbacks when nothing is stored or the store fails, and `originalName` set only on create |
| `rememberOriginalNames.test.ts` | The signed-URL wrapper with a fake plugin handler and a fake key-value store: the name is stored under the signed folder, the body is read once and handed on, the response stays readable, nothing is stored on a refused request or without a name or folder, a store failure does not fail the upload, and startup fails without the plugin endpoint |
| `originalName.test.ts` | Original-name cleaning (characters the key loses are kept, client paths and control characters removed, length cap, empty input), the store key, and reading a stored name back (fresh, expired, malformed) |

None of them needs a database or R2, so the whole suite runs in under a second (most of it is importing Payload for the hook tests). Every code change ships with tests in the same commit (Agent Rules in `CLAUDE.md`). A part that cannot be tested this way is listed in section 14.2.

### 14.2 What is not tested yet

- **Hooks against a real database**: the `beforeTicketChange` hook is unit tested with fakes (section 14.1). The create rule and the seed's path were also run once against real Payload on the dev branch. A full seed run with the new path was not repeated.
- **Access rules end to end**: the agent gets 403 on delete, the admin gets 200.
- **Deploy scripts against real services**: `pnpm migrate` (the table check and the adapter call) and `pnpm r2:cors` (the S3 calls). The rules they use are unit tested. Both were run by hand: `pnpm migrate` stopped with exit code 1 on the dev branch's marker row, and `pnpm r2:cors` set the rule that the browser upload then passed.
- **Uploads against real services**: the `media` hooks and the signed-URL wrapper are unit tested with fakes (section 14.1). Not covered by tests: `deleteFolder` against R2 (listing and batch delete), the real `payload_kv` table, and Payload passing the receipt and temp file to the hook. These are checked by a live script that is not in the repo and by hand in the admin.
- **Admin UI**: login, list filters, inline comments, and the bulk status bar component (its rules are unit tested, the clicks were checked by hand in section 10.1).
- **Roles through the API**: an agent gets 403 on delete, a no-role user cannot log in to the admin, and the CSRF origin check rejects foreign origins.

Planned: integration tests with Vitest against a Neon test branch, and a few Playwright end-to-end tests for the admin. Both are listed in [section 17](#17-known-limitations-and-next-steps).

---

## 15. Commands

| Task | Command |
|---|---|
| Install dependencies | `pnpm install` |
| Start dev server | `pnpm dev` (opens on port 3000 by default) |
| Apply migrations | `pnpm migrate` |
| Migrate, then serve (Render) | `pnpm start:prod` |
| Set R2 CORS | `pnpm r2:cors <origin> [<origin> ...]` (`--dry-run` to preview) |
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
| Sessions | Signed with `PAYLOAD_SECRET`. Stored in `users_sessions`. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` whenever `PAYLOAD_PUBLIC_SERVER_URL` is https (Payload's default is `Secure` off). Checked against a production build. | In place |
| Secrets in git | `.env` is ignored. Only `.env.example` with placeholders is committed. | In place |
| Access control | Every collection has access functions, enforced on REST and local API calls. | In place |
| Anonymous access | Anonymous requests to tickets return 403. The bulk endpoint returns 401. | Verified against the running dev server |
| Upload types, size, and content | Checked on the server: MIME allowlist, 5 MB, extension, magic bytes (section 11.2). | In place |
| Remote URL fetch | Disabled (`pasteURL: false`). Prevents server-side request forgery. | In place |
| File reads | Through the access-controlled route. The bucket is private. | In place |
| Direct upload access | Only staff get a signed R2 upload URL. A document needs a receipt the server signed (section 11.3). | In place |
| R2 CORS | `PUT` only, three headers only, from listed origins only. Set by `pnpm r2:cors` (section 11.3). | In place (dev and Render origins) |
| HTTPS | Render terminates TLS and redirects http to https. The app refuses a non-https `PAYLOAD_PUBLIC_SERVER_URL` in production. | In place |
| Debug output | `next start` runs with `NODE_ENV=production`. Payload returns generic messages for errors that are not public, without stack traces. There is no GraphQL route. | In place |
| Default privileges | New accounts have no roles and no admin access. | In place |
| First-user registration | Payload's `POST /api/users/first-register` creates the first user with `overrideAccess: true`, so it skips the `create` access function. With an empty users table, anyone could have created an admin. The `users` `beforeOperation` hook (`src/hooks/users.ts`, rule `mayCreateUser` in `src/lib/access.ts`) refuses every create that is not from an admin or from the local API. The first admin comes from `pnpm seed`. Checked against real Payload: the first-register call is refused with `Forbidden` and no row is written. | In place |
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
2. Deploy to Render: Blueprint, migrations at start, health check, R2 CORS, `Secure` cookies. Done: live at https://benrey-support-tickets.onrender.com, smoke test in [section 18.5](#185-first-deploy-results).
3. Admin UI: bulk status action on the tickets list. Done ([section 10.1](#101-the-bulk-status-bar-in-the-admin)).
4. Agent view of the admin and list filters at 2,000 tickets. Done ([section 9.4](#94-what-an-agent-sees-checked-on-production), [section 18.5](#185-first-deploy-results)).
5. AI help chat (Groq, free tier) as a custom admin component, grounded in field descriptions.
6. Integration tests for access rules and the bulk endpoint.
7. Login rate limiting and security headers: HSTS, CSP, frame options, and removing `X-Powered-By`. None of them is sent on Render yet.
8. README for the project: setup, stack choice, decisions, what was skipped and why.
9. OAuth (GitHub), only if time is left. Otherwise explained in the README as skipped.

### Open verification items

- Confirmed: after `pnpm seed --reset` on the Neon dev branch, no orphaned comment rows or tag-join rows remain. Child rows are removed through the foreign-key cascade.
- Done: the default 2,000-ticket seed took 233 seconds. Recorded in section 13.5.
- Done: direct upload checked against the dev server with a live script that is not in the repo. It covers signing, the PUT to R2, the receipt, validation, the thumbnail, cleanup, and access. 15 of 15 checks pass.
- Done: the upload checked in the admin in a browser against the dev server. A valid PNG goes straight to R2 and gets a thumbnail. `originalName` keeps characters the key loses (`Отчёт #3 (финал)?.png`). A text file named `.png` is refused with "File content does not match its type." in the toast, its R2 folder is emptied, and no `payload_kv` entry is left.

---

## 18. Deployment on Render

### 18.1 How a deploy runs

1. Render pulls `main` and installs Node from `.node-version` (24.22.2).
2. Build (`render.yaml` `buildCommand`): Corepack installs pnpm 10.34.7 from `packageManager`, `pnpm install --frozen-lockfile`, then `pnpm build`. The build reads every required variable, because `payload.config.ts` loads `env` at import, so a missing variable fails the build already. Render builds on separate machines (2 CPUs, 8 GB). Locally the build peaks at about 1.9 GB, so it fits.
3. Start (`pnpm start:prod`): `pnpm migrate` applies pending migrations and refuses a database with a dev-mode marker (section 12.2). Then `next start` listens on Render's `PORT`.
4. Render calls `/healthz`. When it answers 200, traffic moves to the new version. If the build, the migration, or the health check fails, the previous version keeps serving.

**Why migrations run in the start command.** Render's pre-deploy command is for paid instances only. Running them before `next start` in the same command has the same effect for a single free instance: the server never serves an unmigrated schema. The cost is a few seconds on each cold start, when the migration finds nothing to do.

**Memory.** A free instance has 512 MB. The production server measured about 165 MB idle and about 200 MB after the dashboard, the tickets list at 100 rows, and the API at `depth=2`. `pnpm migrate` exits before `next start` begins, so the two never share the memory.

### 18.2 What runs where

| Item | Where it is set | Notes |
|---|---|---|
| Build, start, health check, region, plan | `render.yaml` | In git |
| Node version | `.node-version` | In git |
| `PAYLOAD_SECRET` | Generated by Render on first Blueprint sync | Never in git, never copied to `.env` |
| `DATABASE_URL`, `PAYLOAD_PUBLIC_SERVER_URL`, `R2_*` | Render dashboard, Environment tab | Entered once. `sync: false` in `render.yaml` |
| R2 CORS | `pnpm r2:cors`, run from a laptop | Bucket setting, not an app setting |
| Admin account and demo data | `pnpm seed`, run from a laptop against the production `DATABASE_URL` | Seed variables are never set on Render |

### 18.3 First deploy, step by step

1. **Neon:** create the production branch, or use `main`, and copy its connection string. It must be a different branch from the dev one. Keep `sslmode=require`.
2. **Render:** New > Blueprint, pick this repository. Render reads `render.yaml` and asks for the `sync: false` values. For `PAYLOAD_PUBLIC_SERVER_URL` enter `https://<service-name>.onrender.com`, the URL Render shows for the service. Enter the R2 values from `.env`.
3. **First deploy:** Render builds and starts. On an empty database `pnpm migrate` creates every table. The admin then shows Payload's "Create first user" form. It is refused by design (section 16): run the seed (step 5) right away, so the database does not sit without an admin.
4. **R2 CORS:** `pnpm r2:cors https://<service-name>.onrender.com http://localhost:3000`.
5. **Seed:** from a laptop, with the production connection string and new seed passwords that are not the dev ones:
   ```bash
   DATABASE_URL='<production url>' SEED_ADMIN_PASSWORD='<new>' SEED_AGENT_PASSWORD='<new>' pnpm seed
   ```
   Never pass `--reset` against production. The seed refuses `--reset` only when `NODE_ENV=production`, which a laptop does not set.
6. **Smoke test:** section 18.4.

### 18.4 Smoke test after a deploy

| Check | Expected |
|---|---|
| `GET /healthz` | 200, `{"status":"ok"}` |
| `http://` URL | Redirects to `https://` |
| `/` | Redirects to `/admin` |
| Admin login as admin | Dashboard opens. The `payload-token` cookie has `Secure`, `HttpOnly`, `SameSite=Lax` |
| Admin login as agent | Users collection is not in the sidebar. Delete is not offered |
| Tickets list | Loads 2,000 seeded tickets. Search and filters answer |
| Upload an image in Media | Uploads straight to R2 (no CORS error), thumbnail shown |
| Upload a text file named `.png` | Refused with "File content does not match its type." |
| Logged-out `GET /api/tickets` | 403 |
| Render logs | No errors. "Migrations are up to date." on start |

The first request after 15 idle minutes wakes the free instance and takes about a minute. Open the URL once before sharing it.

### 18.5 First deploy results

Deployed on 2026-11-11 from `587955b`. Checked against the live URL:

| Check | Result |
|---|---|
| `/healthz`, http to https, `/` to `/admin` | 200, 301, 307 |
| Logged-out API: tickets, customers, media, users, files | 403 |
| Logged-out bulk status endpoint | 401 |
| `first-register` | 403, refused by the users hook |
| GraphQL route | 404 (none) |
| Users after the seed | 9: 1 admin, 8 agents, all created by the seed within 3 seconds. No other account |
| Data | 2,000 tickets, 2,000 customers, 30 tags, 100 seeded media. The five status filters add up to 2,000 |
| API timings from a browser in the EU | Single lists and filters 80 to 200 ms. 100 tickets with relations (`depth=1`) about 1.5 s |
| Admin upload of a PNG | Straight to R2 (200, CORS passes), thumbnail served through the file route, `originalName` keeps `?` |
| Admin upload of a text file named `.png` | Refused with "File content does not match its type.", its R2 folder is empty |
| Agent: admin UI | Sidebar shows Customers, Tags, Tickets, Media. No Users entry, and `/admin/collections/users` is a 404. The ticket edit view has no delete button |
| Agent: API | Reads tickets and users (needed for the assignee field). Creating a user, promoting itself to admin, deleting a ticket, and changing media all answer 403. Its roles stay `["agent"]` |

**Admin list pages at 2,000 tickets** (full admin page render, measured from a browser in the EU, logged in as an agent):

| List view | Matches | Time |
|---|---|---|
| Tickets, default 10 per page | 2,000 | 0.56 s |
| Tickets, 100 per page | 2,000 | 0.80 s |
| Last page (200) | 2,000 | 0.37 s |
| Search "login" | 122 | 0.48 s |
| Filter status = resolved | 387 | 0.60 s |
| Filter priority = urgent and status = new | 37 | 1.29 s |
| Filter on the customer relation (company like "Orchid") | 215 | API |
| Filter on tags (many-to-many) exists | 1,498 | 0.49 s |
| Sort by due date, by priority | 2,000 | 0.42 s, 0.31 s |
| Customers, search "an" (name, email, company) | 531 | 0.30 s |

Ticket search covers the subject only (`listSearchableFields: ['subject']`). Finding tickets by customer goes through the Filters panel on the customer relation.

**Found during the deploy.** Payload's first-user registration skipped access checks, so the empty production database briefly accepted an admin sign-up from anyone. It was fixed in `587955b` before the seed. The users list above shows no account outside the seed. Before the fix the absence of an extra account was not proven: the `create-first-user` string in the admin HTML is a route name and not a sign of an empty table.

**Known gaps.** An invalid enum value in a filter (for example `status=open`) answers 500 with a generic message instead of 400. The admin's filter uses a dropdown, so it cannot send one. Security headers are not set yet (next steps, item 7).
