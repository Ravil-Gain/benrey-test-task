import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'roles'],
    // Hides the sidebar entry only. The access rules below are what actually block agents.
    hidden: ({ user }) => !isAdmin({ req: { user } }),
  },
  access: {
    // Only staff can log in to the admin. Someone with no roles can exist, but can't do anything.
    admin: isStaff,
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
      maxLength: 120,
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      // No default role. An admin has to assign one.
      defaultValue: [],
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Agent', value: 'agent' },
      ],
      access: {
        update: isAdmin,
      },
    },
  ],
}
