import { open, stat } from 'fs/promises'
import { APIError } from 'payload'
import type { CollectionBeforeOperationHook, PayloadRequest } from 'payload'

import { deleteFolder } from '../lib/r2'
import { SIGNATURE_BYTES, validateUpload } from '../lib/uploadRules'

export type IncomingFile = {
  name: string
  mimetype: string
  size: number
  data: Buffer
  tempFilePath?: string
  clientUploadContext?: { prefix?: string; _objectKey?: string }
}

// The upload checks. The collection's mimeTypes option only filters the file picker in the
// browser; these run on the server for every create and update, on the bytes that were stored.
export const beforeMediaOperation: CollectionBeforeOperationHook = async ({ req, operation }) => {
  if (operation !== 'create' && operation !== 'update') {
    return
  }
  const file = req.file as IncomingFile | undefined
  if (!file) {
    return
  }

  const error = validateUpload({
    filename: file.name,
    mimetype: file.mimetype,
    size: await sizeOf(file),
    header: await headerOf(file),
  })
  if (error) {
    await discardRejectedObject(file, req)
    // The admin shows the top-level message as the toast; a ValidationError would hide it.
    throw new APIError(error, 400, { errors: [{ message: error, path: 'filename' }] }, true)
  }
}

// Direct uploads arrive as a temp file. Server-side uploads arrive as a buffer.
async function sizeOf(file: IncomingFile): Promise<number> {
  return file.tempFilePath ? (await stat(file.tempFilePath)).size : file.data.length
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

// A rejected direct upload is already in R2, so its upload folder is removed.
async function discardRejectedObject(file: IncomingFile, req: PayloadRequest): Promise<void> {
  const context = file.clientUploadContext
  if (!context?._objectKey) {
    return
  }
  const folder = [context.prefix, context._objectKey].filter(Boolean).join('/')
  try {
    await deleteFolder(folder)
  } catch (error) {
    req.payload.logger.error({ err: error, folder }, '[media] could not delete the rejected upload')
  }
}
