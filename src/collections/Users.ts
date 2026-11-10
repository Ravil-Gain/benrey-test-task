import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'roles'],
    // Agents never see the Users section in the sidebar.
    hidden: ({ user }) => !isAdmin({ req: { user } }),
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
      maxLength: 120,
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: ['agent'],
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Agent', value: 'agent' },
      ],
      // Only admins can change roles. Access is checked on the field as well.
      access: {
        update: isAdmin,
      },
    },
  ],
}
