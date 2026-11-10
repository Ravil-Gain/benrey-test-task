import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'

export const Customers: CollectionConfig = {
  slug: 'customers',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'email', 'company'],
    listSearchableFields: ['name', 'email', 'company'],
  },
  access: {
    read: isStaff,
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      maxLength: 120,
    },
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
    },
    {
      name: 'company',
      type: 'text',
      maxLength: 120,
    },
  ],
}
