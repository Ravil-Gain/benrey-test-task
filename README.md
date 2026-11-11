# Support Ticket Tracker

An admin panel for a support team: tickets from customers move through a status workflow,
get assigned to agents, collect comments with attachments, and can be bulk-updated. Two
staff roles see and do different things. Built on Payload CMS 3, with PostgreSQL on Neon,
private file storage on Cloudflare R2, and an AI helper that explains the form fields.

**Live:** https://benrey-support-tickets.onrender.com
Demo accounts (one admin, one agent) are shared with reviewers separately; no password is
in this repository. The free Render instance sleeps after 15 idle minutes, so the first
request can take about a minute.

## What it does

- **Tickets with a real workflow.** Every ticket starts as New. Allowed moves:
  New → In progress or Closed; In progress → Waiting for customer or Resolved;
  Waiting → In progress or Resolved; Resolved → In progress (reopen) or Closed; Closed is
  final. In progress needs an assignee. The server enforces this on every write, and the
  status field only offers the moves that are allowed from the saved status.
- **Due dates from priority.** Urgent 4 hours, High 24, Normal 72, Low 168, set on create.
  "Overdue" is worked out on read, with no background job.
- **Two roles that change the admin.** Admins manage users, tags and deletions. Agents work
  on tickets and customers: they do not see the Users section, get no delete buttons, and
  the API refuses them the same actions. New accounts get no role, and only staff can open
  the admin.
- **Customized admin.** Ticket and customer lists with search, filters and sorting at 2,000
  records; comments edited inline on the ticket; a bulk status bar for selected tickets that
  reports which tickets could not move and why.
- **Uploads that stay private.** Browsers upload straight to a private R2 bucket with a
  signed URL. The server checks type, size (5 MB), extension and file signature, and files
  are only served through Payload's access-checked route.
- **AI field help.** A "Field help" button answers "what does this field mean / how do I fill
  it in" from the fields' own descriptions, using an open-weight model on Groq's free tier.
  It never sees records, caps questions at 500 characters, times out after 10 seconds, and
  fails with a friendly message instead of breaking the admin.
- **Realistic demo data.** `pnpm seed` creates 1 admin, 8 agents, 2,000 customers, 30 tags,
  100 attachments and 2,000 tickets, walked through the workflow like real ones.

## Stack, and why

| Part | Choice | Why |
|---|---|---|
| Admin and API | [Payload CMS 3](https://payloadcms.com) on Next.js, TypeScript | The admin is generated from collection configs, so it is the framework's own tooling, not a hand-built UI. Auth, access control, uploads and a REST API come in one package. |
| Database | PostgreSQL on [Neon](https://neon.tech) | Managed and free. Branches give dev and production separate databases with the same engine. Schema changes go through committed migrations. |
| Files | [Cloudflare R2](https://developers.cloudflare.com/r2/) through `@payloadcms/storage-s3` | S3-compatible, free tier, private bucket. Uploads survive redeploys, which local disk on Render would not. |
| Hosting | [Render](https://render.com) web service | Free, HTTPS, builds Node directly. The whole service is described in `render.yaml`. |
| AI | [Groq](https://groq.com), `openai/gpt-oss-20b` | Open-weight, fast, free tier. One synchronous call with a timeout; no chatbot framework. |
| Tests | Vitest | Fast unit tests in TypeScript, no build step. |

Django admin was the first plan and was dropped for Payload: the same generated admin, but
one TypeScript codebase with types generated from the schema. The full reasoning is in the
[architecture decisions](docs/architecture.md).

## Run it locally

You need Node 24 (`.node-version` pins 24.22.2), pnpm 10, a Neon database, and an R2 bucket
with an API token. A Groq key is optional.

```bash
pnpm install
cp .env.example .env        # then fill in the values
pnpm migrate                # create the tables
pnpm seed                   # demo data; prints progress, takes a few minutes
pnpm dev                    # http://localhost:3000/admin
```

Log in with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from your `.env`.

For direct uploads the R2 bucket must allow your origin once:

```bash
pnpm r2:cors http://localhost:3000
```

### Configuration

All settings come from environment variables. A missing required one stops the app at
startup with its name. See [`.env.example`](.env.example).

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string. Use a separate branch for production. |
| `PAYLOAD_SECRET` | yes | Long random string that signs sessions. |
| `PAYLOAD_PUBLIC_SERVER_URL` | yes | The app's origin, no path. It is also the CSRF allowlist. Must be https in production. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | yes | The private R2 bucket and its token. |
| `GROQ_API_KEY` | no | Enables the AI field help. Without it the help says it is not set up. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_AGENT_PASSWORD` | for `pnpm seed` | Seeded accounts. Passwords of 12+ characters. |

### Commands

| Command | Does |
|---|---|
| `pnpm dev` | Dev server with hot reload |
| `pnpm test` | Unit tests |
| `pnpm typecheck` | TypeScript check |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm migrate` | Apply migrations; stops on a dev-mode schema push instead of prompting |
| `pnpm payload migrate:create <name>` | New migration after a schema change |
| `pnpm seed` / `pnpm seed --reset` | Fill an empty database / wipe and refill (never in production) |
| `pnpm r2:cors <origin> …` | Set the R2 bucket's CORS rule |

## Deploy

Render reads [`render.yaml`](render.yaml): New → Blueprint → this repository, then enter the
secret values it asks for. Every deploy builds with a frozen lockfile, runs migrations
before the server starts, and switches traffic only after `/healthz` answers. After the
first deploy, add the Render origin to R2 CORS and run `pnpm seed` once against the
production database. Step by step: [technical guide, section 18](docs/technical-guide.md#18-deployment-on-render).

## How it is built

```
Browser ──► Render: Next.js + Payload ──► Neon PostgreSQL
   │              │ REST API, admin, hooks
   │              └──────────────► Groq (field help only)
   └── signed PUT ──► Cloudflare R2 (private) ◄── Payload file route
```

- **Rules live in one place.** The workflow is `src/lib/ticketStatus.ts`; due dates, upload
  checks and role checks are pure functions in `src/lib/`. Collection hooks and endpoints call
  them, so the admin, the REST API, the bulk endpoint and the seed all follow the same rules.
- **Roles are access functions**, not hidden buttons. Payload hides controls from the same
  results, so what the admin shows matches what the API allows.
- **Two custom endpoints:** `POST /api/tickets/bulk-status` and `POST /api/ai-help`. Both
  check the caller's role on the server. Everything else is Payload's own API.
- **Three custom admin components:** the bulk status bar, the ticket status field and the
  field help button. Nothing else replaces Payload's UI.

## Tests

`pnpm test` runs 185 unit tests in about a second, with no database or network: every
status transition and the start rule, due dates, roles, upload validation, the hooks and
both endpoints with fake requests, the AI context and every AI failure path, and the deploy
scripts' rules. What they do not cover (real database, R2, browser flows) is listed in the
[technical guide, section 14](docs/technical-guide.md#14-tests); those parts were checked by
hand on the dev server and on Render.

## Left out on purpose

- **OAuth sign-in.** A bonus; the role model and the core admin came first. New OAuth users
  would start with no role, like any new account.
- **Login rate limiting and security headers** (HSTS, CSP). Not done yet; they are the next
  hardening step. Only the AI help has a per-user limit.
- **Email notifications and SLA escalation.** They need background jobs. The app is one
  synchronous web service on purpose, with no queue or worker to run and pay for.
- **Row-level permissions.** Agents see all tickets. Fine for one small team.
- **Filtering by "overdue".** It is computed on read, so the database cannot filter on it.
- **Moving the due date when priority changes.** The due date is set once, on create.
- **Re-encoding uploaded images.** The signature check reads the first bytes only. Files are
  never served from a public URL, which keeps the risk small.

## With more time

1. Integration tests against a Neon test branch, and a few Playwright tests for the admin.
2. Login rate limiting and security headers.
3. A stored, indexed "overdue" flag kept up to date, so it can be filtered.
4. GitHub OAuth, with an admin approving the role of each new user.
5. A paid Render instance, to remove the cold start.

## Documentation

- [Technical guide](docs/technical-guide.md): every config file, variable, collection, hook,
  endpoint and command, plus what was checked and how.
- [Architecture](docs/architecture.md): decision records (ADRs) with the trade-offs.
