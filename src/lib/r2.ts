import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'

import { env } from './env'

// Used only to remove an object that the browser uploaded straight to R2 and that then
// failed validation. Everything else goes through the storage plugin.

let client: S3Client | undefined

function r2Client(): S3Client {
  if (!client) {
    const r2 = env.r2()
    client = new S3Client({
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    })
  }
  return client
}

// Deletes every object under one upload folder. Each direct upload gets its own random
// folder, so nothing else lives there. Deleting the folder avoids guessing the stored
// file name, because Payload sanitizes the client's name before it is used as the key.
export async function deleteFolder(folder: string): Promise<void> {
  if (!folder) {
    throw new Error('deleteFolder needs a non-empty folder')
  }
  const client = r2Client()
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
