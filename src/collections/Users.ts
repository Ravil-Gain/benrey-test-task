import type { CollectionConfig } from 'payload'

import { beforeUserChange, beforeUserOperation } from '../hooks/users'
import { isAdmin, isAdminOrSelf, isStaff } from '../lib/access'
import { env, isHttpsOrigin } from '../lib/env'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    cookies: {
      // Payload leaves Secure off by default.
      secure: isHttpsOrigin(env.serverUrl()),
      sameSite: 'Lax',
    },
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'roles'],
    // Hides the sidebar entry only. The access rules below are what block agents.
    hidden: ({ user }) => !isAdmin({ req: { user } }),
  },
  access: {
    // Only staff can log in to the admin. A user with no roles can exist but can do nothing.
    admin: isStaff,
    read: isStaff,
    create: isAdmin,
    update: isAdminOrSelf,
    delete: isAdmin,
  },
  hooks: {
    // Also blocks Payload's public first-user registration, which skips `access`.
    beforeOperation: [beforeUserOperation],
    beforeChange: [beforeUserChange],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      maxLength: 120,
      admin: { description: "The staff member's full name, shown as assignee and comment author." },
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      // No default role. An admin has to assign one.
      defaultValue: [],
      admin: {
        description:
          'Admin manages users, tags and deletes. Agent works on tickets and customers. A user with no role cannot open the admin. Only admins change roles, and an admin cannot remove their own admin role.',
      },
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Agent', value: 'agent' },
      ],
      access: {
        create: isAdmin,
        update: isAdmin,
      },
    },
  ],
}
