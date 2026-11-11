import { randomBytes } from 'crypto'
import sharp from 'sharp'
import type { Payload } from 'payload'

import type { Ticket } from '../payload-types'
import type { TicketPriority } from '../lib/dueDate'
import { INITIAL_STATUS, OPEN_STATUSES, type TicketStatus } from '../lib/ticketStatus'
import { createRandom, type Random } from './random'
import {
  AGENT_NAMES,
  COMMENT_BODIES,
  COMPANIES,
  DESCRIPTIONS,
  FIRST_NAMES,
  LAST_NAMES,
  SUBJECTS,
  TAG_COLORS,
  TAG_NAMES,
} from './data'
import type { SeedOptions } from './options'

const SEED = 20261110 // the same seed every run, so bugs on demo data can be reproduced
const CUSTOMER_COUNT = 2000
const MEDIA_COUNT = 100
const SCREENSHOT_COUNT = 60 // the rest are text logs
const BATCH_SIZE = 10 // writes that run in parallel
const DAY_MS = 24 * 60 * 60 * 1000
const OPEN_TICKET_MAX_AGE_DAYS = 7 // open tickets are recent, so only some are overdue
const DONE_TICKET_MAX_AGE_DAYS = 30

const SEEDED_COLLECTIONS = ['users', 'customers', 'tags', 'tickets', 'media'] as const

const PRIORITY_WEIGHTS: Record<TicketPriority, number> = {
  low: 15,
  normal: 50,
  high: 25,
  urgent: 10,
}
const STATUS_WEIGHTS: Record<TicketStatus, number> = {
  new: 20,
  in_progress: 25,
  waiting_customer: 15,
  resolved: 20,
  closed: 20,
}

// Each ticket is created as "New" and then moved one allowed step at a time, so the hook
// checks every step and stamps the times. Closed tickets go through Resolved, like real ones.
const STATUS_PATHS: Record<TicketStatus, TicketStatus[]> = {
  new: [],
  in_progress: ['in_progress'],
  waiting_customer: ['in_progress', 'waiting_customer'],
  resolved: ['in_progress', 'resolved'],
  closed: ['in_progress', 'resolved', 'closed'],
}

const RETRY_ATTEMPTS = 3
const TRANSIENT_ERROR = /ETIMEDOUT|ECONNRESET|EPIPE|Connection terminated|timeout/i

type Refs = {
  customers: number[]
  agents: number[]
  tags: number[]
  media: number[]
}

let startedAt = Date.now()

export async function runSeed(payload: Payload, options: SeedOptions): Promise<void> {
  if (options.reset) {
    log('Resetting existing data')
    await resetAll(payload)
  } else {
    const existing = await countExisting(payload)
    if (existing) {
      log(
        `Database already has data (${existing}). Run with --reset --confirm=<host> to regenerate.`,
      )
      return
    }
  }

  const rng = createRandom(SEED)
  startedAt = Date.now()

  const agents = await seedStaff(payload, options)
  log(`Staff: 1 admin, ${agents.length} agents`)

  const customers = await seedCustomers(payload, rng, CUSTOMER_COUNT)
  log(`Customers: ${customers.length}`)

  const tags = await seedTags(payload, rng)
  log(`Tags: ${tags.length}`)

  const media = await seedMedia(payload, rng, MEDIA_COUNT)
  log(`Media: ${media.length} files`)

  await seedTickets(payload, rng, options.ticketCount, { customers, agents, tags, media })

  log('Done')
}

// "3 users, 12 tickets" for the collections that hold rows, or an empty string.
async function countExisting(payload: Payload): Promise<string> {
  const counts = await Promise.all(
    SEEDED_COLLECTIONS.map(async (collection) => ({
      collection,
      total: (await payload.count({ collection, overrideAccess: true })).totalDocs,
    })),
  )
  return counts
    .filter(({ total }) => total > 0)
    .map(({ collection, total }) => `${total} ${collection}`)
    .join(', ')
}

// Media goes through payload.delete so the files in R2 get removed too. The rest is one
// database-level delete per table.
async function resetAll(payload: Payload): Promise<void> {
  await payload.delete({
    collection: 'media',
    where: { id: { exists: true } },
    overrideAccess: true,
  })
  for (const collection of ['tickets', 'customers', 'tags', 'users'] as const) {
    await payload.db.deleteMany({ collection, where: { id: { exists: true } } })
  }
}

// The first agent is the demo account and gets SEED_AGENT_PASSWORD. The others get a random
// password each, so no two accounts share one. An admin can set a new one in the admin.
async function seedStaff(payload: Payload, options: SeedOptions): Promise<number[]> {
  await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: {
      email: options.adminEmail,
      name: 'Support Admin',
      password: options.adminPassword,
      roles: ['admin'],
    },
  })

  const agents: number[] = []
  for (const [index, name] of AGENT_NAMES.entries()) {
    const agent = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        email: `${slug(name)}@support.example.test`,
        name,
        password: index === 0 ? options.agentPassword : randomBytes(24).toString('base64url'),
        roles: ['agent'],
      },
    })
    agents.push(agent.id)
  }
  return agents
}

async function seedCustomers(payload: Payload, rng: Random, count: number): Promise<number[]> {
  const ids: number[] = []
  for (let start = 0; start < count; start += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, count - start)
    // Built before any await, so the random sequence does not depend on timing.
    const rows = Array.from({ length: size }, (_, offset) => {
      const first = rng.pick(FIRST_NAMES)
      const last = rng.pick(LAST_NAMES)
      return {
        name: `${first} ${last}`,
        email: `${slug(first)}.${slug(last)}.${start + offset}@customers.example.test`,
        company: rng.pick(COMPANIES),
      }
    })
    const docs = await Promise.all(
      rows.map((data) =>
        withRetry(() => payload.create({ collection: 'customers', overrideAccess: true, data })),
      ),
    )
    ids.push(...docs.map((doc) => doc.id))
  }
  return ids
}

async function seedTags(payload: Payload, rng: Random): Promise<number[]> {
  const ids: number[] = []
  for (const name of TAG_NAMES) {
    const tag = await payload.create({
      collection: 'tags',
      overrideAccess: true,
      data: { name, color: rng.pick(TAG_COLORS) },
    })
    ids.push(tag.id)
  }
  return ids
}

async function seedMedia(payload: Payload, rng: Random, count: number): Promise<number[]> {
  const files: { alt: string; name: string; mimetype: string; data: Buffer }[] = []
  for (let i = 0; i < count; i++) {
    files.push(
      i < SCREENSHOT_COUNT
        ? {
            alt: `Screenshot ${i + 1}`,
            name: `screenshot-${i + 1}.png`,
            mimetype: 'image/png',
            data: await makePng(rng),
          }
        : {
            alt: `Log ${i + 1}`,
            name: `log-${i + 1}.txt`,
            mimetype: 'text/plain',
            data: Buffer.from(
              `Log excerpt ${i + 1}\nStatus: 500\nRetrying in 30 seconds\n`,
              'utf8',
            ),
          },
    )
  }

  const ids: number[] = []
  for (let start = 0; start < files.length; start += 5) {
    const docs = await Promise.all(
      files.slice(start, start + 5).map((file) =>
        withRetry(() =>
          payload.create({
            collection: 'media',
            overrideAccess: true,
            data: { alt: file.alt },
            file: {
              data: file.data,
              mimetype: file.mimetype,
              name: file.name,
              size: file.data.length,
            },
          }),
        ),
      ),
    )
    ids.push(...docs.map((doc) => doc.id))
  }
  return ids
}

async function makePng(rng: Random): Promise<Buffer> {
  return sharp({
    create: {
      width: 480,
      height: 320,
      channels: 3,
      background: { r: rng.int(40, 230), g: rng.int(40, 230), b: rng.int(40, 230) },
    },
  })
    .png()
    .toBuffer()
}

async function seedTickets(
  payload: Payload,
  rng: Random,
  count: number,
  refs: Refs,
): Promise<void> {
  const now = Date.now()

  for (let start = 0; start < count; start += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, count - start)
    const batch = Array.from({ length: size }, (_, offset) =>
      buildTicket(rng, refs, start + offset, now),
    )

    await Promise.all(
      batch.map(async ({ data, steps }) => {
        const ticket = await withRetry(() =>
          payload.create({ collection: 'tickets', overrideAccess: true, data }),
        )
        for (const status of steps) {
          await withRetry(() =>
            payload.update({
              collection: 'tickets',
              id: ticket.id,
              overrideAccess: true,
              data: { status },
            }),
          )
        }
      }),
    )

    const done = start + size
    if (done % 1000 === 0 || done === count) {
      log(`Tickets: ${done}/${count}`)
    }
  }
}

function buildTicket(rng: Random, refs: Refs, index: number, now: number) {
  const status = rng.weighted(STATUS_WEIGHTS)
  const priority = rng.weighted(PRIORITY_WEIGHTS)
  const company = rng.pick(COMPANIES)
  // In progress needs an assignee, so every ticket past "New" gets one. Some new ones too.
  const assignee = status !== 'new' || rng.next() < 0.4 ? rng.pick(refs.agents) : undefined

  const tags = new Set<number>()
  const tagCount = rng.int(0, 3)
  while (tags.size < tagCount) {
    tags.add(rng.pick(refs.tags))
  }

  const comments = Array.from({ length: rng.int(0, 5) }, () => ({
    body: rng.pick(COMMENT_BODIES),
    author: rng.pick(refs.agents),
    attachments: rng.next() < 0.08 ? [rng.pick(refs.media)] : undefined,
  }))

  // Created in the past, so due dates (set by the hook from createdAt and priority) are
  // spread out and the older open tickets are overdue.
  const maxAgeDays = OPEN_STATUSES.includes(status)
    ? OPEN_TICKET_MAX_AGE_DAYS
    : DONE_TICKET_MAX_AGE_DAYS
  const createdAt = new Date(now - rng.next() * maxAgeDays * DAY_MS).toISOString()

  return {
    steps: STATUS_PATHS[status],
    data: {
      subject: `${rng.pick(SUBJECTS)} - ${company} #${index + 1}`,
      description: rng.next() < 0.3 ? richText(rng.pick(DESCRIPTIONS)) : undefined,
      status: INITIAL_STATUS,
      priority,
      customer: rng.pick(refs.customers),
      assignee,
      tags: [...tags],
      comments,
      createdAt,
    } satisfies Partial<Ticket> & { subject: string; customer: number },
  }
}

// Runs the operation again when the error looks like a dropped network connection.
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!TRANSIENT_ERROR.test(message) || attempt === RETRY_ATTEMPTS) {
        throw error
      }
      log(`Transient database error, retrying (${attempt}/${RETRY_ATTEMPTS - 1}): ${message}`)
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }
  throw lastError
}

function log(message: string): void {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[seed +${elapsed}s] ${message}`)
}

function richText(text: string): Ticket['description'] {
  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      children: [
        {
          type: 'paragraph',
          format: '',
          indent: 0,
          version: 1,
          direction: 'ltr',
          textFormat: 0,
          textStyle: '',
          children: [
            { type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '', version: 1 },
          ],
        },
      ],
    },
  }
}

// "Priya Shah" -> "priya.shah", for email addresses.
function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
}
