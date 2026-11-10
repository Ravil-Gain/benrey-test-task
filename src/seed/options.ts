/**
 * Seed options come from flags and environment variables.
 *
 * Passwords are never stored in code. They must be set in the environment, and
 * each one must be at least 12 characters.
 */

export type SeedOptions = {
  reset: boolean
  ticketCount: number
  adminEmail: string
  adminPassword: string
  agentPassword: string
}

const MIN_PASSWORD_LENGTH = 12
const DEFAULT_TICKET_COUNT = 2000

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function requirePassword(name: string): string {
  const value = requireEnv(name)
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  return value
}

export function parseSeedOptions(argv: string[], env: NodeJS.ProcessEnv): SeedOptions {
  const reset = argv.includes('--reset')

  if (reset && env.NODE_ENV === 'production') {
    throw new Error('Refusing to run --reset with NODE_ENV=production')
  }

  const countFlag = argv.find((arg) => arg.startsWith('--tickets='))
  const ticketCount = countFlag ? Number(countFlag.split('=')[1]) : DEFAULT_TICKET_COUNT
  if (!Number.isInteger(ticketCount) || ticketCount < 1 || ticketCount > 100000) {
    throw new Error('--tickets must be an integer between 1 and 100000')
  }

  return {
    reset,
    ticketCount,
    adminEmail: requireEnv('SEED_ADMIN_EMAIL').toLowerCase(),
    adminPassword: requirePassword('SEED_ADMIN_PASSWORD'),
    agentPassword: requirePassword('SEED_AGENT_PASSWORD'),
  }
}
