import { randomUUID } from 'crypto'
import { ValidationError } from 'payload'
import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
] as const

type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number]

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

// The stored extension comes from the checked MIME type, never from the client's file name.
const EXTENSION_BY_MIME: Record<AllowedMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
}

// Carries the uploader's file name from beforeOperation to beforeChange.
const ORIGINAL_NAME_KEY = 'originalFileName'

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
  },
  hooks: {
    // The mimeTypes option above only filters the file picker in the browser.
    // The real checks run here, so an API call can't skip them.
    beforeOperation: [
      ({ req, operation }) => {
        if (operation !== 'create' && operation !== 'update') {
          return
        }
        const file = req.file
        if (!file) {
          return
        }

        if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
          throw new ValidationError({
            collection: 'media',
            errors: [{ message: `File type ${file.mimetype} is not allowed.`, path: 'filename' }],
            req,
          })
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new ValidationError({
            collection: 'media',
            errors: [{ message: 'File is larger than 5 MB.', path: 'filename' }],
            req,
          })
        }

        // Keep the uploader's name for display. Store the file under a random name,
        // so names can't collide and clients can't pick the path.
        req.context[ORIGINAL_NAME_KEY] = file.name
        file.name = `${randomUUID()}${EXTENSION_BY_MIME[file.mimetype as AllowedMime]}`
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
