import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { Customers } from '../../src/collections/Customers'
import { Tags } from '../../src/collections/Tags'
import { Tickets } from '../../src/collections/Tickets'

type FieldConfig = { name?: string; index?: boolean; unique?: boolean; required?: boolean }

function field(fields: readonly unknown[], name: string): FieldConfig {
  const found = (fields as FieldConfig[]).find((entry) => entry.name === name)
  if (!found) throw new Error(`no field ${name}`)
  return found
}

describe('ticket fields the list filters and sorts on are indexed', () => {
  it.each(['status', 'priority', 'dueAt'])('%s has an index', (name) => {
    expect(field(Tickets.fields, name).index).toBe(true)
  })

  it('the migration that adds those indexes is committed', () => {
    const migrations = readFileSync(path.join(__dirname, '../../src/migrations/index.ts'), 'utf8')
    expect(migrations).toMatch(/ticket_filter_indexes/)
  })
})

describe('constraints stay in the schema', () => {
  it('keeps required and unique fields', () => {
    expect(field(Tickets.fields, 'subject').required).toBe(true)
    expect(field(Tickets.fields, 'status').required).toBe(true)
    expect(field(Tickets.fields, 'customer').required).toBe(true)
    expect(field(Customers.fields, 'email').unique).toBe(true)
    expect(field(Tags.fields, 'name').unique).toBe(true)
  })
})

describe('favicon.ico', () => {
  const ico = readFileSync(path.join(__dirname, '../../src/app/favicon.ico'))

  it('is a real ICO file with 16, 32 and 48 pixel images', () => {
    expect(ico.readUInt16LE(0)).toBe(0) // reserved
    expect(ico.readUInt16LE(2)).toBe(1) // type: icon
    const count = ico.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + i * 16))
    expect(sizes).toEqual([16, 32, 48])
  })

  it('stores PNG images that fit inside the file', () => {
    const count = ico.readUInt16LE(4)
    for (let i = 0; i < count; i++) {
      const length = ico.readUInt32LE(6 + i * 16 + 8)
      const offset = ico.readUInt32LE(6 + i * 16 + 12)
      expect(offset + length).toBeLessThanOrEqual(ico.length)
      expect(ico.subarray(offset, offset + 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    }
  })
})
