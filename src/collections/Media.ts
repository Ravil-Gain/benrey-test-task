import type { CollectionConfig } from 'payload'

import { beforeMediaChange, beforeMediaOperation } from '../hooks/media'
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
    // Only filters the file picker in the browser. The server checks run in the hooks.
    mimeTypes: [...ALLOWED_MIME_TYPES],
    imageSizes: [{ name: 'thumbnail', width: 240, height: 240, position: 'centre' }],
    // Never let the server fetch a URL the client sends (SSRF).
    pasteURL: false,
    // Direct uploads to R2 need a receipt the server signed. Without it, a client could
    // point a document at an object it never received a receipt for.
    requiresClientUploadReceipt: true,
  },
  hooks: {
    beforeOperation: [beforeMediaOperation],
    beforeChange: [beforeMediaChange],
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
