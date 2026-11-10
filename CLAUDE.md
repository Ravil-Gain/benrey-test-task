<!-- planfirst:start -->
## Architecture Reference
Full spec: `./docs/architecture.md` — read before adding any infrastructure.

### Stack (momento: validate)
- Framework: Payload CMS 3 (stable 3.x, pinned exact) on Next.js App Router, TypeScript strict, Node.js 24 LTS (24.22.2 or later), pnpm 10
- Admin: Payload admin, extended only via `admin.components` (bulk status action, AI help widget)
- Database: PostgreSQL on Neon via `@payloadcms/db-postgres` (DATABASE_URL)
- Object storage: Cloudflare R2 via `@payloadcms/storage-s3` (private bucket, served through Payload's file route)
- Image processing: sharp
- Hosting: Render Node web service
- Tests: Vitest for business logic
- AI help chat (later): Groq free-tier open-weight model, synchronous, 10s timeout

### Agent Rules
- Keep `docs/technical-guide.md` in sync with the code in the same commit. Any change to a config file, dependency, environment variable, collection, hook, endpoint, command, or seed behaviour must update the matching section of that guide.
- DO NOT add Redis, BullMQ, Celery, or any task queue or background worker. The AI call is synchronous with a 10-second timeout.
- DO NOT add a SQLite fallback or any other local database. Every environment MUST use PostgreSQL via DATABASE_URL.
- DO NOT hardcode PAYLOAD_SECRET, DATABASE_URL, R2 credentials, or the AI API key. Read all of them from environment variables. Startup MUST fail if a required variable is missing in production.
- DO NOT commit `.env` or any real secret. `.env.example` MUST contain placeholder values only.
- DO NOT store uploaded files on local disk in production. Use `@payloadcms/storage-s3` pointed at R2. The bucket MUST be private.
- DO NOT use `@payloadcms/storage-r2`. This app runs on Node, not Cloudflare Workers.
- DO NOT serve uploaded files by public URL. Files MUST be read through Payload's file route so access control applies.
- DO NOT build a separate Express, Nest, or Fastify API. Use Payload's REST and local API, and Next.js route handlers only for custom endpoints.
- DO NOT build a separate SPA or a second admin UI. Extend the Payload admin only through `admin.components`.
- DO NOT put business rules in React components or route handlers. Status transitions and validation MUST live in collection hooks or pure functions in `src/lib/` that hooks call.
- Role restrictions MUST be enforced in collection `access` functions. A hidden button or hidden collection is not a restriction on its own.
- The bulk status endpoint and the AI endpoint MUST check the caller's role on the server, not only in the component.
- Schema changes MUST be made with `payload migrate:create` and committed. Production MUST run `payload migrate`. DO NOT use `push` in production.
- Every upload MUST be validated: MIME allowlist on the `media` collection, 5 MB size limit, and generated filenames (UUID plus the extension from the validated MIME type; the original name goes to `originalName`).
- New users MUST NOT get a default role. Roles are assigned only by admins, and admin panel access requires a staff role.
- `PAYLOAD_PUBLIC_SERVER_URL` MUST be set. It is the CSRF allowlist. DO NOT leave `csrf` empty.
- The AI endpoint MUST send only field metadata (label, admin.description, select options) and the user's question to the model. DO NOT send database records or other users' data.
- The AI endpoint MUST cap user input at 500 characters and MUST return a friendly error on timeout or API failure. DO NOT let an AI failure break the admin.
- Seed data MUST be created by the `pnpm seed` script (a TypeScript script using Payload's local API). DO NOT load demo data in migrations.
- Ticket status transitions MUST be defined only in `src/lib/ticketStatus.ts`. The `tickets` hook and the bulk status endpoint MUST both call that module. DO NOT duplicate the transition map anywhere else.
- The bulk status endpoint MUST apply the same transition and guard checks per ticket, and MUST report invalid transitions instead of failing the whole batch.
- Every status transition and validation rule MUST have a Vitest test.
<!-- planfirst:end -->
