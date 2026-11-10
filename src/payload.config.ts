import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { env } from './lib/env'
import { Customers } from './collections/Customers'
import { Media } from './collections/Media'
import { Tags } from './collections/Tags'
import { Tickets } from './collections/Tickets'
import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const r2 = env.r2()

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' · Support',
    },
  },
  collections: [Users, Customers, Tags, Tickets, Media],
  editor: lexicalEditor(),
  secret: env.payloadSecret(),
  db: postgresAdapter({
    pool: {
      connectionString: env.databaseUrl(),
    },
    // Schema changes only happen through committed migrations, never by auto-sync.
    push: false,
  }),
  plugins: [
    // Private R2 bucket. Files are read through Payload's access-controlled route.
    s3Storage({
      collections: {
        media: true,
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
  ],
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
