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
      admin: { description: 'The person who contacts support. Up to 120 characters.' },
    },
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
      admin: { description: 'Where support replies go. Each customer has a different email.' },
    },
    {
      name: 'company',
      type: 'text',
      maxLength: 120,
      admin: { description: 'The organization the customer belongs to. Optional.' },
    },
    {
      // Read from tickets.customer; nothing is stored on the customer.
      name: 'tickets',
      type: 'join',
      collection: 'tickets',
      on: 'customer',
      defaultSort: '-createdAt',
      admin: {
        defaultColumns: ['subject', 'status', 'priority', 'dueAt'],
        description: 'The tickets this customer has opened, newest first.',
      },
    },
  ],
}
