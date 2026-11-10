/**
 * Entry point for `pnpm seed`. Usage:
 *   pnpm seed                 seed an empty database
 *   pnpm seed --reset         delete all data, then seed again (never in production)
 *   pnpm seed --tickets=500   seed a smaller number of tickets
 */
import 'dotenv/config'
import { getPayload } from 'payload'

import config from '../payload.config'
import { parseSeedOptions } from './options'
import { runSeed } from './run'

async function main(): Promise<void> {
  const options = parseSeedOptions(process.argv.slice(2), process.env)
  const payload = await getPayload({ config })

  try {
    await runSeed(payload, options)
  } finally {
    await payload.destroy()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
