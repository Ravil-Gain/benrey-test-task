import type { CollectionConfig } from 'payload'

import { beforeMediaOperation } from '../hooks/media'
import { isAdmin, isStaff } from '../lib/access'
import { ALLOWED_MIME_TYPES } from '../lib/uploadRules'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: isStaff,
    create: isStaff,
    update: isAdmin,
    delete: isAdmin,
  },
  upload: {
    // Filters the file picker only. The server checks run in the hook.
    mimeTypes: [...ALLOWED_MIME_TYPES],
    imageSizes: [{ name: 'thumbnail', width: 240, height: 240, position: 'centre' }],
    // Never let the server fetch a URL the client sends (SSRF).
    pasteURL: false,
    // A direct upload to R2 needs a receipt the server signed.
    requiresClientUploadReceipt: true,
  },
  hooks: {
    beforeOperation: [beforeMediaOperation],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      maxLength: 200,
      admin: {
        description:
          'A short text that says what the file shows, for screen readers. Up to 200 characters.',
      },
    },
  ],
}
