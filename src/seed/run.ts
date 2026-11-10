import sharp from 'sharp'
import type { Payload } from 'payload'

import type { Ticket } from '../payload-types'
import type { TicketPriority } from '../lib/dueDate'
import type { TicketStatus } from '../lib/ticketStatus'
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

const SEED_RANDOM = 20261110
const CUSTOMER_COUNT = 2000
const MEDIA_COUNT = 100
const MEDIA_IMAGE_COUNT = 60
const CHUNK_SIZE = 10
const DAY_MS = 24 * 60 * 60 * 1000

// Weights are relative, not percentages.
const PRIORITY_WEIGHTS: Record<TicketPriority, number> = { low: 15, normal: 50, high: 25, urgent: 10 }
const STATUS_WEIGHTS: Record<TicketStatus, number> = {
  new: 20,
  in_progress: 25,
  waiting_customer: 15,
  resolved: 20,
  closed: 20,
}
const OPEN_STATUSES: readonly TicketStatus[] = ['new', 'in_progress', 'waiting_customer']

type TicketContext = {
  customers: number[]
  agents: number[]
  tags: number[]
  media: number[]
}

/**
 * Creates demo data through the Payload local API, so every hook, access rule,
 * and storage adapter runs as it does for real users.
 */
export async function runSeed(payload: Payload, options: SeedOptions): Promise<void> {
  const existingTickets = await payload.count({ collection: 'tickets', overrideAccess: true })

  if (options.reset) {
    log('Resetting existing data')
    await resetAll(payload)
  } else if (existingTickets.totalDocs > 0) {
    log(`Database already has ${existingTickets.totalDocs} tickets. Run with --reset to regenerate.`)
    return
  }

  const rng = createRandom(SEED_RANDOM)
  startedAt = Date.now()

  const agents = await seedStaff(payload, options)
  log(`Staff: 1 admin, ${agents.length} agents`)

  const customers = await seedCustomers(payload, rng, CUSTOMER_COUNT)
  log(`Customers: ${customers.length}`)

  const tags = await seedTags(payload, rng)
  log(`Tags: ${tags.length}`)

  const media = await seedMedia(payload, rng, MEDIA_COUNT)
  log(`Media: ${media.length} files`)

  await seedTickets(payload, rng, options.ticketCount, {
    customers,
    agents,
    tags,
    media,
  })

  log('Done')
}

let startedAt = Date.now()

function log(message: string): void {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[seed +${elapsed}s] ${message}`)
}

/**
 * Deletes everything. Media goes through payload.delete so the R2 files are
 * removed too. Other collections use the database-level delete, which is one
 * query per table and does not run per-document hooks.
 */
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

/** Creates the admin and the agents. Returns the agent IDs for ticket assignment. */
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
  for (let start = 0; start < count; start += CHUNK_SIZE) {
    const size = Math.min(CHUNK_SIZE, count - start)
    // Data is built synchronously so the random sequence stays deterministic.
    const rows = Array.from({ length: size }, (_, offset) => {
      const i = start + offset
      const first = rng.pick(FIRST_NAMES)
      const last = rng.pick(LAST_NAMES)
      return {
        name: `${first} ${last}`,
        // The index keeps emails unique. `.test` is reserved for examples.
        email: `${slug(first)}.${slug(last)}.${i}@customers.example.test`,
        company: rng.pick(COMPANIES),
      }
    })
    const docs = await Promise.all(
      rows.map((data) =>
        payload.create({ collection: 'customers', overrideAccess: true, data }),
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

const MEDIA_UPLOAD_CONCURRENCY = 5

async function seedMedia(payload: Payload, rng: Random, count: number): Promise<number[]> {
  // Generate the files first (cheap, CPU only), then upload them in small parallel batches.
  const files = []
  for (let i = 0; i < count; i++) {
    const isImage = i < MEDIA_IMAGE_COUNT
    files.push({
      alt: isImage ? `Screenshot ${i + 1}` : `Log ${i + 1}`,
      data: isImage
        ? await makePng(rng)
        : Buffer.from(`Log excerpt ${i + 1}\nStatus: 500\nRetrying in 30 seconds\n`, 'utf8'),
      mimetype: isImage ? 'image/png' : 'text/plain',
      name: isImage ? `screenshot-${i + 1}.png` : `log-${i + 1}.txt`,
    })
  }

  const ids: number[] = []
  for (let start = 0; start < files.length; start += MEDIA_UPLOAD_CONCURRENCY) {
    const batch = files.slice(start, start + MEDIA_UPLOAD_CONCURRENCY)
    const docs = await Promise.all(
      batch.map((file) =>
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
  ctx: TicketContext,
): Promise<void> {
  const now = Date.now()

  for (let start = 0; start < count; start += CHUNK_SIZE) {
    const size = Math.min(CHUNK_SIZE, count - start)

    // Build the chunk synchronously so the random sequence does not depend on timing.
    const chunk = Array.from({ length: size }, (_, offset) =>
      buildTicket(rng, ctx, start + offset, now),
    )

    await Promise.all(
      chunk.map(async ({ data, overdueDueAt }) => {
        const ticket = await payload.create({
          collection: 'tickets',
          overrideAccess: true,
          data,
        })
        // The create hook sets dueAt from priority. For some open tickets, move
        // the due date into the past so the overdue filter has real data to show.
        if (overdueDueAt) {
          await payload.update({
            collection: 'tickets',
            id: ticket.id,
            overrideAccess: true,
            data: { dueAt: overdueDueAt },
          })
        }
      }),
    )

    const done = start + size
    if (done % 1000 === 0 || done === count) {
      log(`Tickets: ${done}/${count}`)
    }
  }
}

function buildTicket(rng: Random, ctx: TicketContext, index: number, now: number) {
  const status = rng.weighted(STATUS_WEIGHTS)
  const priority = rng.weighted(PRIORITY_WEIGHTS)
  const customer = rng.pick(ctx.customers)
  const company = rng.pick(COMPANIES)

  // Statuses after "new" need an assignee, because the workflow requires one.
  const assignee = status !== 'new' || rng.next() < 0.4 ? rng.pick(ctx.agents) : undefined

  const tagCount = rng.int(0, 3)
  const tags = new Set<number>()
  while (tags.size < tagCount) {
    tags.add(rng.pick(ctx.tags))
  }

  const comments = Array.from({ length: rng.int(0, 5) }, () => ({
    body: rng.pick(COMMENT_BODIES),
    author: rng.pick(ctx.agents),
    attachments: rng.next() < 0.08 ? [rng.pick(ctx.media)] : undefined,
  }))

  const overdue =
    OPEN_STATUSES.includes(status) && rng.next() < 0.3
      ? new Date(now - rng.int(1, 30) * DAY_MS).toISOString()
      : undefined

  return {
    overdueDueAt: overdue,
    data: {
      subject: `${rng.pick(SUBJECTS)} - ${company} #${index + 1}`,
      description: rng.next() < 0.3 ? richText(rng.pick(DESCRIPTIONS)) : undefined,
      status,
      priority,
      customer,
      assignee,
      tags: [...tags],
      comments,
    } satisfies Partial<Ticket> & { subject: string; customer: number },
  }
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

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
}
