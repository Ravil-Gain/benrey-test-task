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

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

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
    // Disables server-side fetching from remote URLs (SSRF risk).
    pasteURL: false,
  },
  hooks: {
    // The `mimeTypes` option only filters the file picker in the browser.
    // The server enforces the same rules here, for every write path.
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
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      maxLength: 200,
    },
  ],
}
