import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'
import { isOverdue, TICKET_PRIORITIES } from '../lib/dueDate'
import { TICKET_STATUS_LABELS, TICKET_STATUSES, type TicketStatus } from '../lib/ticketStatus'
import { beforeTicketChange } from '../hooks/tickets'
import { bulkStatus } from '../endpoints/bulkStatus'

// Dates the server fills in. They show in the sidebar but nobody types them.
const serverDate = {
  readOnly: true,
  position: 'sidebar',
  date: { pickerAppearance: 'dayAndTime' },
} as const

export const Tickets: CollectionConfig = {
  slug: 'tickets',
  admin: {
    useAsTitle: 'subject',
    defaultColumns: ['subject', 'status', 'priority', 'assignee', 'dueAt'],
    listSearchableFields: ['subject'],
    components: {
      // Bulk status change for the selected rows. It calls the bulk-status endpoint below.
      beforeListTable: ['/components/BulkStatusBar#BulkStatusBar'],
    },
  },
  access: {
    read: isStaff,
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [beforeTicketChange],
  },
  endpoints: [
    {
      path: '/bulk-status',
      method: 'post',
      handler: bulkStatus,
    },
  ],
  fields: [
    {
      name: 'subject',
      type: 'text',
      required: true,
      minLength: 5,
      maxLength: 200,
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'new',
      options: TICKET_STATUSES.map((value) => ({ label: TICKET_STATUS_LABELS[value], value })),
      // The transition rules are checked in beforeTicketChange, not here.
      admin: { position: 'sidebar' },
    },
    {
      name: 'priority',
      type: 'select',
      required: true,
      defaultValue: 'normal',
      options: TICKET_PRIORITIES.map((value) => ({
        label: value.charAt(0).toUpperCase() + value.slice(1),
        value,
      })),
      admin: { position: 'sidebar' },
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'assignee',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar' },
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
    },
    {
      name: 'dueAt',
      type: 'date',
      admin: serverDate,
    },
    {
      // Not stored. Worked out every time the ticket is read.
      name: 'isOverdue',
      type: 'checkbox',
      virtual: true,
      admin: { readOnly: true, position: 'sidebar' },
      hooks: {
        afterRead: [
          ({ siblingData }) =>
            isOverdue({
              dueAt: siblingData.dueAt as string | undefined,
              status: siblingData.status as TicketStatus,
              now: new Date(),
            }),
        ],
      },
    },
    {
      name: 'resolvedAt',
      type: 'date',
      admin: serverDate,
    },
    {
      name: 'closedAt',
      type: 'date',
      admin: serverDate,
    },
    {
      name: 'comments',
      type: 'array',
      labels: { singular: 'Comment', plural: 'Comments' },
      admin: {
        description: 'Edit comments right here. The server fills in the author and time.',
      },
      fields: [
        {
          name: 'body',
          type: 'textarea',
          required: true,
          maxLength: 5000,
        },
        {
          name: 'attachments',
          type: 'upload',
          relationTo: 'media',
          hasMany: true,
          maxRows: 5,
        },
        {
          name: 'author',
          type: 'relationship',
          relationTo: 'users',
          admin: { readOnly: true },
        },
        {
          name: 'createdAt',
          type: 'date',
          admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } },
        },
      ],
    },
  ],
}
