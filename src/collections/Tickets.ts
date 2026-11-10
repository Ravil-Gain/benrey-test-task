import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'
import { isOverdue, TICKET_PRIORITIES } from '../lib/dueDate'
import { TICKET_STATUSES, type TicketStatus } from '../lib/ticketStatus'
import { beforeTicketChange } from '../hooks/tickets'
import { bulkStatus } from '../endpoints/bulkStatus'

const STATUS_LABELS: Record<(typeof TICKET_STATUSES)[number], string> = {
  new: 'New',
  in_progress: 'In progress',
  waiting_customer: 'Waiting for customer',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const Tickets: CollectionConfig = {
  slug: 'tickets',
  admin: {
    useAsTitle: 'subject',
    defaultColumns: ['subject', 'status', 'priority', 'assignee', 'dueAt'],
    listSearchableFields: ['subject'],
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
      options: TICKET_STATUSES.map((value) => ({ label: STATUS_LABELS[value], value })),
      // Changes go through the transition rules in the beforeChange hook.
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
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
    {
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
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'closedAt',
      type: 'date',
      admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'comments',
      type: 'array',
      labels: { singular: 'Comment', plural: 'Comments' },
      admin: {
        description: 'Comments are edited inline with the ticket. Author and time are set by the server.',
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
