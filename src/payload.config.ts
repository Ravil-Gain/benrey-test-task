import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { env } from './lib/env'
import { isStaff } from './lib/access'
import { MAX_UPLOAD_BYTES } from './lib/uploadRules'
import { Customers } from './collections/Customers'
import { Media } from './collections/Media'
import { Tags } from './collections/Tags'
import { Tickets } from './collections/Tickets'
import { Users } from './collections/Users'
import { rememberOriginalNames } from './plugins/rememberOriginalNames'

const here = path.dirname(fileURLToPath(import.meta.url))

const r2 = env.r2()
const serverURL = env.serverUrl()

export default buildConfig({
  serverURL,
  // Payload refuses cookie requests from origins not on this list. Its default list
  // is empty, which switches that check off, so we set it ourselves.
  csrf: [serverURL],
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: here,
    },
    meta: {
      titleSuffix: ' · Support',
    },
  },
  collections: [Users, Customers, Tags, Tickets, Media],
  // Size limit for every upload, including the signed URLs for direct uploads.
  upload: {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
    },
  },
  editor: lexicalEditor(),
  secret: env.payloadSecret(),
  db: postgresAdapter({
    pool: {
      connectionString: env.databaseUrl(),
      // Stops idle connections from being dropped silently.
      keepAlive: true,
    },
    // Schema changes go through migrations only. Never auto-sync.
    push: false,
  }),
  onInit: (payload) => {
    // Without this listener, one failed idle connection crashes the whole process.
    payload.db.pool.on('error', (error) => {
      console.error('[db] idle connection error, the pool will reconnect:', error.message)
    })
  },
  plugins: [
    // Private R2 bucket. Files are only read through Payload's access-checked route.
    // Browsers upload straight to R2 with a signed URL. Only staff can get one.
    s3Storage({
      collections: {
        media: true,
      },
      clientUploads: {
        access: ({ req }) => isStaff({ req }),
      },
      bucket: r2.bucket,
      config: {
        endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
        region: 'auto',
        credentials: {
          accessKeyId: r2.accessKeyId,
          secretAccessKey: r2.secretAccessKey,
        },
      },
    }),
    // Must come after s3Storage: wraps its signed-URL endpoint to keep the uploader's file name.
    rememberOriginalNames,
  ],
  sharp,
  typescript: {
    outputFile: path.resolve(here, 'payload-types.ts'),
  },
})
