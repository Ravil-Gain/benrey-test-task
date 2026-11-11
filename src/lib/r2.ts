import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'

import { env } from './env'

// The S3 client settings for R2. Shared by the storage plugin, the CORS script and deleteFolder.
export function r2ClientConfig() {
  const r2 = env.r2()
  return {
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  }
}

let client: S3Client | undefined

// Deletes every object under one upload folder. Each direct upload gets its own random folder,
// so this removes exactly one rejected upload without guessing its sanitized file name.
export async function deleteFolder(folder: string): Promise<void> {
  if (!folder) {
    throw new Error('deleteFolder needs a non-empty folder')
  }
  client ??= new S3Client(r2ClientConfig())
  const Bucket = env.r2().bucket
  const Prefix = `${folder}/`
  let token: string | undefined
  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: token }),
    )
    const keys = (listed.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []))
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }),
      )
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (token)
}
