import { describe, expect, it } from 'vitest'

import { parseSeedOptions } from '../../src/seed/options'

const env = {
  DATABASE_URL:
    'postgresql://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  SEED_ADMIN_EMAIL: 'Admin@Example.test',
  SEED_ADMIN_PASSWORD: 'admin-password-12',
  SEED_AGENT_PASSWORD: 'agent-password-12',
}

describe('parseSeedOptions', () => {
  it('reads the accounts from the environment and defaults to 2000 tickets', () => {
    expect(parseSeedOptions([], env)).toEqual({
      reset: false,
      ticketCount: 2000,
      adminEmail: 'admin@example.test',
      adminPassword: 'admin-password-12',
      agentPassword: 'agent-password-12',
    })
    expect(parseSeedOptions(['--tickets=50'], env).ticketCount).toBe(50)
  })

  it('refuses --reset unless --confirm names the database host', () => {
    expect(() => parseSeedOptions(['--reset'], env)).toThrow(
      /--confirm=ep-cool-name-123\.eu-central-1\.aws\.neon\.tech/,
    )
    expect(() => parseSeedOptions(['--reset', '--confirm=localhost'], env)).toThrow(/--confirm=/)
    expect(
      parseSeedOptions(['--reset', '--confirm=ep-cool-name-123.eu-central-1.aws.neon.tech'], env)
        .reset,
    ).toBe(true)
  })

  it('never prints the connection string in the refusal', () => {
    expect(() => parseSeedOptions(['--reset'], env)).toThrow(expect.not.stringContaining('user:pw'))
  })

  it('refuses short passwords, a missing variable and a bad ticket count', () => {
    expect(() => parseSeedOptions([], { ...env, SEED_AGENT_PASSWORD: 'short' })).toThrow(
      /at least 12/,
    )
    expect(() => parseSeedOptions([], { ...env, SEED_ADMIN_EMAIL: '' })).toThrow(/SEED_ADMIN_EMAIL/)
    expect(() => parseSeedOptions(['--tickets=0'], env)).toThrow(/--tickets/)
    expect(() => parseSeedOptions(['--tickets=abc'], env)).toThrow(/--tickets/)
  })
})
