import type { Config, PayloadHandler } from 'payload'

import { cleanOriginalName, originalNameKey, storedOriginalName } from '../lib/originalName'

// The endpoint that @payloadcms/storage-s3 adds when clientUploads is on.
const SIGNED_URL_PATH = '/storage-s3-generate-signed-url'

// Wraps the storage plugin's signed-URL endpoint so it also remembers the file name the
// uploader picked (see src/lib/originalName.ts). The plugin's own checks (access, MIME,
// size, signed receipt) run unchanged. Must be listed after s3Storage in `plugins`.
export function rememberOriginalNames(config: Config): Config {
  const endpoint = config.endpoints?.find(
    (candidate) => candidate.path === SIGNED_URL_PATH && candidate.method === 'post',
  )
  if (!endpoint) {
    throw new Error(
      `rememberOriginalNames: no ${SIGNED_URL_PATH} endpoint. List it after s3Storage with clientUploads on.`,
    )
  }

  const signedUrlHandler = endpoint.handler
  const handler: PayloadHandler = async (req) => {
    if (!req.json) {
      return signedUrlHandler(req)
    }
    // The body can be read only once, so read it here and hand the same value on.
    const body: unknown = await req.json()
    req.json = async () => body

    const response = await signedUrlHandler(req)
    if (!response.ok) {
      return response
    }

    const name = cleanOriginalName((body as { filename?: unknown } | null)?.filename)
    const { clientUploadContext } = (await response.clone().json()) as {
      clientUploadContext?: { _objectKey?: unknown }
    }
    const objectKey = clientUploadContext?._objectKey
    if (name && typeof objectKey === 'string') {
      try {
        await req.payload.kv.set(originalNameKey(objectKey), storedOriginalName(name, Date.now()))
      } catch (error) {
        // Not worth failing the upload over. The media hook falls back to the stored name.
        req.payload.logger.error({ err: error }, '[media] could not store the original file name')
      }
    }
    return response
  }
  endpoint.handler = handler

  return config
}
