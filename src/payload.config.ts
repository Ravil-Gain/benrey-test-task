import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { env } from './lib/env'
import { isStaff } from './lib/access'
import { r2ClientConfig } from './lib/r2'
import { MAX_UPLOAD_BYTES } from './lib/uploadRules'
import { Customers } from './collections/Customers'
import { Media } from './collections/Media'
import { Tags } from './collections/Tags'
import { Tickets } from './collections/Tickets'
import { Users } from './collections/Users'
import { aiHelp } from './endpoints/aiHelp'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverURL = env.serverUrl()

export default buildConfig({
  serverURL,
  // Payload's default allowlist is empty, which turns the origin check off.
  csrf: [serverURL],
  admin: {
    user: Users.slug,
    importMap: { baseDir: here },
    meta: {
      titleSuffix: ' · Support',
      icons: [{ rel: 'icon', type: 'image/x-icon', url: '/favicon.ico' }],
    },
    components: {
      // The "Field help" button in the admin header (POST /api/ai-help).
      actions: ['/components/AiHelp#AiHelp'],
    },
  },
  endpoints: [{ path: '/ai-help', method: 'post', handler: aiHelp }],
  collections: [Users, Customers, Tags, Tickets, Media],
  upload: {
    limits: { fileSize: MAX_UPLOAD_BYTES },
  },
  editor: lexicalEditor(),
  secret: env.payloadSecret(),
  db: postgresAdapter({
    pool: {
      connectionString: env.databaseUrl(),
      keepAlive: true,
    },
    // Schema changes go through committed migrations only.
    push: false,
  }),
  onInit: (payload) => {
    // Without a listener, one failed idle connection crashes the whole process.
    payload.db.pool.on('error', (error) => {
      payload.logger.error({ err: error }, '[db] idle connection error, the pool will reconnect')
    })
  },
  plugins: [
    // Private R2 bucket. Browsers upload straight to it with a signed URL (staff only), and
    // files are read back only through Payload's access-checked route.
    s3Storage({
      collections: { media: true },
      clientUploads: { access: ({ req }) => isStaff({ req }) },
      bucket: env.r2().bucket,
      config: r2ClientConfig(),
    }),
  ],
  sharp,
  typescript: {
    outputFile: path.resolve(here, 'payload-types.ts'),
  },
})
