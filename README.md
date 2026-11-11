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

## Data model

The brief's four models, plus the two that make them work:

| Model | What it is | Relations and constraints |
|---|---|---|
| Ticket | Subject, description, status, priority, due date | Required FK to Customer; optional FK to an agent (assignee); many-to-many to Tag; status and priority are enums; subject 5–200 characters |
| Customer | Name, email, company | Email required and unique |
| Agent | A user with the `agent` role | Users have roles `admin` and `agent`; no role means no admin access |
| Comment | A row inside a ticket, edited inline | Author and time set by the server; up to 5 attachments (FK to Media) |
| Tag | Name and color | Name unique; color must be a hex code |
| Media | An uploaded file in R2 | Type, size, extension and file signature checked on the server |

Comments are an array field on the ticket rather than a collection of their own (Payload
stores them in a `tickets_comments` table), because they are always read and edited with
their ticket; that is what makes them editable inline. Schema
changes go through committed migrations (`src/migrations/`), never through auto-sync.

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

Settings come only from environment variables; a missing required one stops the app at
startup with its name. The list is in [`.env.example`](.env.example) and the
[technical guide, section 5](docs/technical-guide.md#5-environment-variables). All commands:
[section 15](docs/technical-guide.md#15-commands). The everyday ones are `pnpm dev`,
`pnpm test` and `pnpm typecheck`.

> **`pnpm seed --reset` deletes every ticket, customer, tag, file and user, then seeds again.**
> It refuses to run only when `NODE_ENV=production`, which a laptop does not set, so check
> `DATABASE_URL` before using it. Against production, only ever run `pnpm seed` without
> `--reset`, once, on an empty database.

## Deploy

Production runs `next start`, so debug mode is off and Next.js serves the static assets.
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

## Security

| Brief item | How it is met |
|---|---|
| Hashed passwords | Payload's default: PBKDF2-SHA256 with a salt, never stored in plain text |
| Sessions | HttpOnly, SameSite=Lax cookie, Secure on https; sessions stored server-side and expire after 2 hours |
| Brute force | An account locks for 10 minutes after 5 failed logins (Payload's default, checked) |
| CSRF | Cookie requests from any origin other than `PAYLOAD_PUBLIC_SERVER_URL` are treated as anonymous |
| Input validation | Field rules on every collection; uploads checked by type, size, extension and file signature; AI questions capped at 500 characters |
| Secrets | Only in environment variables; `.env` is ignored by git and `.env.example` has placeholders |
| HTTPS | Render serves https and redirects http; production refuses a non-https server URL |
| Accounts | No public sign-up; users are created by an admin or by the seed, and new users get no role |

## Tests

| Command | What runs |
|---|---|
| `pnpm test` | 198 unit tests in about a second, no database or network: every status transition and the start rule, due dates, roles, upload validation, the hooks and both endpoints with fake requests, the AI context and every AI failure path |
| `pnpm test:integration` | 13 tests on a separate `_test` database the setup creates and migrates: access rules, the workflow on real writes, the bulk endpoint |
| `pnpm test:e2e` | 10 Playwright tests in Chromium, as admin, agent and logged out: menus, delete rights, bulk bar, status field, field help |

What is still checked by hand (R2, real Groq answers) is listed in the
[technical guide, section 14](docs/technical-guide.md#14-tests).

## Left out on purpose

- **OAuth sign-in.** A bonus; the role model and the core admin came first. New OAuth users
  would start with no role, like any new account.
- **Per-IP rate limiting and security headers** (HSTS, CSP). Accounts lock after 5 failed
  logins, but there is no limit per IP address yet, and the response headers are Next.js
  defaults. They are the next hardening step.
- **Email notifications and SLA escalation.** They need background jobs. The app is one
  synchronous web service on purpose, with no queue or worker to run and pay for.
- **Row-level permissions.** Agents see all tickets. Fine for one small team.
- **Filtering by "overdue".** It is computed on read, so the database cannot filter on it.
- **Moving the due date when priority changes.** The due date is set once, on create.
- **Re-encoding uploaded images.** The signature check reads the first bytes only. Files are
  never served from a public URL, which keeps the risk small.

## Trade-offs made

- **Migrations run in the start command.** Render's free plan has no pre-deploy step, so
  `pnpm migrate` runs before `next start`. A failed migration stops the start and the
  previous version keeps serving. The cost is a few seconds on each cold start.
- **The AI help's rate limit lives in memory.** Enough for one free instance; more instances
  would need a shared store.
- **Uploads pass through the server once.** The browser sends the file straight to R2, but
  the server still reads it back to check its content and make thumbnails, in a temporary
  file deleted at the end of the request.

## With more time

1. Per-IP rate limiting on login and security headers.
2. A stored, indexed "overdue" flag kept up to date, so it can be filtered.
3. GitHub OAuth, with an admin approving the role of each new user.
4. Running the three test suites in CI on every push.
5. A paid Render instance, to remove the cold start.

## Documentation

- [Technical guide](docs/technical-guide.md): every config file, variable, collection, hook,
  endpoint and command, plus what was checked and how.
- [Architecture](docs/architecture.md): decision records (ADRs) with the trade-offs.
