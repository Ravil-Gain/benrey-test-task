/**
 * Sets the CORS rule on the R2 bucket. Usage:
 *   pnpm r2:cors https://<app>.onrender.com http://localhost:3000
 *   pnpm r2:cors --dry-run https://<app>.onrender.com     print the rule, change nothing
 *
 * Pass every origin the admin runs on. The rule replaces the bucket's whole CORS config.
 * The R2 token in .env needs permission to change bucket settings.
 */
import 'dotenv/config'
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'

import { env } from '../lib/env'
import { buildCorsRules } from '../lib/r2Cors'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const rules = buildCorsRules(args.filter((arg) => arg !== '--dry-run'))

  const r2 = env.r2()
  const client = new S3Client({
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  })

  const current = await client
    .send(new GetBucketCorsCommand({ Bucket: r2.bucket }))
    .then((result) => result.CORSRules ?? [])
    .catch(() => [])
  console.log('Current rule:', JSON.stringify(current, null, 2))
  console.log('New rule:', JSON.stringify(rules, null, 2))

  if (dryRun) {
    console.log('Dry run, nothing changed.')
    return
  }
  await client.send(
    new PutBucketCorsCommand({ Bucket: r2.bucket, CORSConfiguration: { CORSRules: rules } }),
  )
  console.log(`CORS updated on bucket ${r2.bucket}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
