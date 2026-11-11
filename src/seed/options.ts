import { requireEnv, type EnvSource } from '../lib/env'

export type SeedOptions = {
  reset: boolean
  ticketCount: number
  adminEmail: string
  adminPassword: string
  agentPassword: string
}

const MIN_PASSWORD_LENGTH = 12
const DEFAULT_TICKET_COUNT = 2000

function flag(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
}

function requirePassword(name: string, env: EnvSource): string {
  const value = requireEnv(name, env)
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  return value
}

// Flags and environment variables for `pnpm seed`. `--reset` wipes the database, so it only
// runs with `--confirm=<host>` naming the database host it is about to wipe.
export function parseSeedOptions(argv: string[], env: EnvSource): SeedOptions {
  const reset = argv.includes('--reset')
  if (reset) {
    const host = new URL(requireEnv('DATABASE_URL', env)).hostname
    if (flag(argv, '--confirm') !== host) {
      throw new Error(
        `--reset deletes every user, ticket, customer, tag and file in the database at ${host}. ` +
          `Run it again with --confirm=${host} if that is the database you mean.`,
      )
    }
  }

  const count = flag(argv, '--tickets')
  const ticketCount = count === undefined ? DEFAULT_TICKET_COUNT : Number(count)
  if (!Number.isInteger(ticketCount) || ticketCount < 1 || ticketCount > 100_000) {
    throw new Error('--tickets must be an integer between 1 and 100000')
  }

  return {
    reset,
    ticketCount,
    adminEmail: requireEnv('SEED_ADMIN_EMAIL', env).toLowerCase(),
    adminPassword: requirePassword('SEED_ADMIN_PASSWORD', env),
    agentPassword: requirePassword('SEED_AGENT_PASSWORD', env),
  }
}
