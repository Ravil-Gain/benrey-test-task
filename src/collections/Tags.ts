import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const Tags: CollectionConfig = {
  slug: 'tags',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'color'],
  },
  access: {
    read: isStaff,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
      maxLength: 40,
    },
    {
      name: 'color',
      type: 'text',
      validate: (value: string | null | undefined) =>
        !value || HEX_COLOR.test(value) || 'Use a hex color such as #1a2b3c',
    },
  ],
}
