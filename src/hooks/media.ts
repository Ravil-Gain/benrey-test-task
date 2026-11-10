import { open, stat } from 'fs/promises'
import { APIError } from 'payload'
import type {
  CollectionBeforeChangeHook,
  CollectionBeforeOperationHook,
  PayloadRequest,
} from 'payload'

import { cleanOriginalName, originalNameKey, readStoredOriginalName } from '../lib/originalName'
import { deleteFolder } from '../lib/r2'
import { SIGNATURE_BYTES, validateUpload } from '../lib/uploadRules'

// Carries the uploader's file name from beforeOperation to beforeChange.
export const ORIGINAL_NAME_CONTEXT_KEY = 'originalFileName'

export type IncomingFile = {
  name: string
  mimetype: string
  size: number
  data: Buffer
  tempFilePath?: string
  clientUploadContext?: { prefix?: string; _objectKey?: string }
}

// The upload checks. The collection's mimeTypes option only filters the file picker in the
// browser, so the real checks run here, on every create and update, and an API call
// can't skip them.
export const beforeMediaOperation: CollectionBeforeOperationHook = async ({ req, operation }) => {
  if (operation !== 'create' && operation !== 'update') {
    return
  }
  const file = req.file as IncomingFile | undefined
  if (!file) {
    return
  }

  // Check what was actually stored, not what the client declared.
  const error = validateUpload({
    filename: file.name,
    mimetype: file.mimetype,
    size: await sizeOf(file),
    header: await headerOf(file),
  })
  // A direct upload's real name was stored when its signed URL was issued. Take it
  // now, also on rejection, so the entry never outlives this request.
  const clientName = await takeClientOriginalName(req, file)

  if (error) {
    await discardRejectedObject(file)
    // The admin shows the top-level message as the toast. A ValidationError would put
    // only "The following field is invalid: filename" there and hide the reason.
    throw new APIError(error, 400, { errors: [{ message: error, path: 'filename' }] }, true)
  }

  req.context[ORIGINAL_NAME_CONTEXT_KEY] = clientName ?? cleanOriginalName(file.name)
}

// originalName is set by the server only, once, when the document is created.
export const beforeMediaChange: CollectionBeforeChangeHook = ({ data, req, operation }) => {
  const originalName = req.context[ORIGINAL_NAME_CONTEXT_KEY]
  if (operation === 'create' && typeof originalName === 'string') {
    data.originalName = originalName
  }
  return data
}

// Direct uploads arrive as a temp file. Server-side uploads arrive as a buffer.
async function sizeOf(file: IncomingFile): Promise<number> {
  if (file.tempFilePath) {
    return (await stat(file.tempFilePath)).size
  }
  return file.data.length
}

async function headerOf(file: IncomingFile): Promise<Uint8Array> {
  if (file.data.length > 0) {
    return file.data.subarray(0, SIGNATURE_BYTES)
  }
  if (!file.tempFilePath) {
    return new Uint8Array()
  }
  const handle = await open(file.tempFilePath, 'r')
  try {
    const buffer = Buffer.alloc(SIGNATURE_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, SIGNATURE_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

// Reads and deletes the name that rememberOriginalNames stored for this direct upload.
// Returns null for server-side uploads and when nothing valid was stored.
async function takeClientOriginalName(
  req: PayloadRequest,
  file: IncomingFile,
): Promise<string | null> {
  const objectKey = file.clientUploadContext?._objectKey
  if (!objectKey) {
    return null
  }
  const key = originalNameKey(objectKey)
  try {
    const stored = await req.payload.kv.get(key)
    if (stored !== null) {
      await req.payload.kv.delete(key)
    }
    return readStoredOriginalName(stored, Date.now())
  } catch (error) {
    req.payload.logger.error({ err: error }, '[media] could not read the original file name')
    return null
  }
}

// A rejected direct upload is already in R2, so remove it. Delete its whole upload folder,
// which holds only this upload (see deleteFolder).
async function discardRejectedObject(file: IncomingFile): Promise<void> {
  const context = file.clientUploadContext
  if (!context?._objectKey) {
    return
  }
  const folder = [context.prefix, context._objectKey].filter(Boolean).join('/')
  try {
    await deleteFolder(folder)
  } catch (error) {
    console.error('[media] could not delete rejected upload folder', folder, error)
  }
}
