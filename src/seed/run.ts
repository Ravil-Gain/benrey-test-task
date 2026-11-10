import sharp from 'sharp'
import type { Payload } from 'payload'

import type { Ticket } from '../payload-types'
import type { TicketPriority } from '../lib/dueDate'
import { INITIAL_STATUS, statusPath, type TicketStatus } from '../lib/ticketStatus'
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

const SEED = 20261110 // same seed every run, so bugs on demo data can be reproduced
const CUSTOMER_COUNT = 2000
const MEDIA_COUNT = 100
const SCREENSHOT_COUNT = 60 // the rest are text logs
const BATCH_SIZE = 10 // how many writes run in parallel
const DAY_MS = 24 * 60 * 60 * 1000

const PRIORITY_WEIGHTS: Record<TicketPriority, number> = { low: 15, normal: 50, high: 25, urgent: 10 }
const STATUS_WEIGHTS: Record<TicketStatus, number> = {
  new: 20,
  in_progress: 25,
  waiting_customer: 15,
  resolved: 20,
  closed: 20,
}
const OPEN_STATUSES: readonly TicketStatus[] = ['new', 'in_progress', 'waiting_customer']

const RETRY_ATTEMPTS = 3
// Network errors that are worth another try against a remote database.
const TRANSIENT_ERROR = /ETIMEDOUT|ECONNRESET|EPIPE|Connection terminated|timeout/i

type Refs = {
  customers: number[]
  agents: number[]
  tags: number[]
  media: number[]
}

let startedAt = Date.now()

export async function runSeed(payload: Payload, options: SeedOptions): Promise<void> {
  const existing = await payload.count({ collection: 'tickets', overrideAccess: true })

  if (options.reset) {
    log('Resetting existing data')
    await resetAll(payload)
  } else if (existing.totalDocs > 0) {
    log(`Database already has ${existing.totalDocs} tickets. Run with --reset to regenerate.`)
    return
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

// Media goes through payload.delete so the files in R2 get removed too.
// Everything else is one database-level delete per table, which skips the hooks.
async function resetAll(payload: Payload): Promise<void> {
  await payload.delete({
    collection: 'media',
    where: { id: { exists: true } },
    overrideAccess: true,
  })
  for (const collection of ['tickets', 'customers', 'tags', 'users'] as const) {
    await payload.db.deleteMany({
      collection,
      where: { id: { exists: true } },
    })
  }
}

// Returns the agent IDs so tickets can be assigned to them.
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
  for (const name of AGENT_NAMES) {
    const agent = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        email: `${slug(name)}@support.example.test`,
        name,
        password: options.agentPassword,
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

    // Build the rows before any await, so the random sequence doesn't depend on timing.
    const rows = Array.from({ length: size }, (_, offset) => {
      const first = rng.pick(FIRST_NAMES)
      const last = rng.pick(LAST_NAMES)
      return {
        name: `${first} ${last}`,
        // The index makes the email unique. .test is reserved for examples.
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
  // Make all the files first. That part is CPU only and quick.
  const files: { alt: string; name: string; mimetype: string; data: Buffer }[] = []
  for (let i = 0; i < count; i++) {
    const isScreenshot = i < SCREENSHOT_COUNT
    files.push(
      isScreenshot
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
            data: Buffer.from(`Log excerpt ${i + 1}\nStatus: 500\nRetrying in 30 seconds\n`, 'utf8'),
          },
    )
  }

  // Then upload them a few at a time.
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

// A plain coloured rectangle is enough for a demo screenshot.
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
      batch.map(async ({ data, pastDueAt, laterStatuses }) => {
        const ticket = await withRetry(() =>
          payload.create({ collection: 'tickets', overrideAccess: true, data }),
        )
        // Tickets go through the workflow like real ones: created at the first step from
        // "New", then moved one allowed step at a time. The tickets hook checks every step.
        for (const next of laterStatuses) {
          await withRetry(() =>
            payload.update({
              collection: 'tickets',
              id: ticket.id,
              overrideAccess: true,
              data: { status: next },
            }),
          )
        }
        // The create hook sets dueAt from the priority. For some open tickets we move it
        // back into the past, so the overdue view has real examples to show.
        if (pastDueAt) {
          await withRetry(() =>
            payload.update({
              collection: 'tickets',
              id: ticket.id,
              overrideAccess: true,
              data: { dueAt: pastDueAt },
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
  const customer = rng.pick(refs.customers)
  const company = rng.pick(COMPANIES)

  // The workflow needs an assignee before a ticket can be in progress, so most
  // non-new tickets get one. Some new ones get one too.
  const assignee = status !== 'new' || rng.next() < 0.4 ? rng.pick(refs.agents) : undefined

  const tagCount = rng.int(0, 3)
  const tags = new Set<number>()
  while (tags.size < tagCount) {
    tags.add(rng.pick(refs.tags))
  }

  const comments = Array.from({ length: rng.int(0, 5) }, () => ({
    body: rng.pick(COMMENT_BODIES),
    author: rng.pick(refs.agents),
    attachments: rng.next() < 0.08 ? [rng.pick(refs.media)] : undefined,
  }))

  const pastDueAt =
    OPEN_STATUSES.includes(status) && rng.next() < 0.3
      ? new Date(now - rng.int(1, 30) * DAY_MS).toISOString()
      : undefined

  // The first move from "New" is allowed on create, the rest are updates.
  const path = statusPath(INITIAL_STATUS, status)
  if (!path) {
    throw new Error(`Seed status "${status}" cannot be reached from "${INITIAL_STATUS}"`)
  }
  const [firstStatus = INITIAL_STATUS, ...laterStatuses] = path

  return {
    pastDueAt,
    laterStatuses,
    data: {
      subject: `${rng.pick(SUBJECTS)} - ${company} #${index + 1}`,
      description: rng.next() < 0.3 ? richText(rng.pick(DESCRIPTIONS)) : undefined,
      status: firstStatus,
      priority,
      customer,
      assignee,
      tags: [...tags],
      comments,
    } satisfies Partial<Ticket> & { subject: string; customer: number },
  }
}

// Runs the operation again if the error looks like a dropped network connection.
// Anything else fails straight away.
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
          children: [{ type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '', version: 1 }],
        },
      ],
    },
  }
}

// "Priya Shah" -> "priya.shah". Used for email addresses.
function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
}
