import { open, stat } from 'fs/promises'
import { ValidationError } from 'payload'
import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'
import { deleteFolder } from '../lib/r2'
import { ALLOWED_MIME_TYPES, SIGNATURE_BYTES, validateUpload } from '../lib/uploadRules'

// Carries the uploader's file name from beforeOperation to beforeChange.
const ORIGINAL_NAME_KEY = 'originalFileName'

type IncomingFile = {
  name: string
  mimetype: string
  size: number
  data: Buffer
  tempFilePath?: string
  clientUploadContext?: { prefix?: string; _objectKey?: string }
}

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: isStaff,
    create: isStaff,
    update: isAdmin,
    delete: isAdmin,
  },
  upload: {
    mimeTypes: [...ALLOWED_MIME_TYPES],
    imageSizes: [{ name: 'thumbnail', width: 240, height: 240, position: 'centre' }],
    // Never let the server fetch a URL the client sends (SSRF).
    pasteURL: false,
    // Direct uploads to R2 need a receipt the server signed. Without it, a client could
    // point a document at an object it never received a receipt for.
    requiresClientUploadReceipt: true,
  },
  hooks: {
    // The mimeTypes option above only filters the file picker in the browser.
    // The real checks run here, so an API call can't skip them.
    beforeOperation: [
      async ({ req, operation }) => {
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
        if (error) {
          await discardRejectedObject(file)
          throw new ValidationError({
            collection: 'media',
            errors: [{ message: error, path: 'filename' }],
            req,
          })
        }

        req.context[ORIGINAL_NAME_KEY] = file.name
      },
    ],
    beforeChange: [
      ({ data, req, operation }) => {
        const originalName = req.context[ORIGINAL_NAME_KEY]
        if (operation === 'create' && typeof originalName === 'string') {
          data.originalName = originalName.slice(0, 200)
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      maxLength: 200,
    },
    {
      // Set by the server. Shown for reference only.
      name: 'originalName',
      type: 'text',
      admin: { readOnly: true },
    },
  ],
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
