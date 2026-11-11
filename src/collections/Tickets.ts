import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'
import {
  describeDueWindows,
  isOverdue,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
} from '../lib/dueDate'
import {
  describeWorkflow,
  INITIAL_STATUS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketStatus,
} from '../lib/ticketStatus'
import { beforeTicketChange } from '../hooks/tickets'
import { bulkStatus } from '../endpoints/bulkStatus'

// Dates the server fills in. Field access, not only admin.readOnly: a value sent through the
// API is dropped before the hook runs.
const serverDate = {
  type: 'date',
  access: { create: () => false, update: () => false },
  admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
} as const

export const Tickets: CollectionConfig = {
  slug: 'tickets',
  admin: {
    useAsTitle: 'subject',
    defaultColumns: ['subject', 'status', 'priority', 'assignee', 'dueAt'],
    listSearchableFields: ['subject', 'id', 'customer.name', 'customer.email'],
    components: {
      beforeListTable: [
        '/components/OverdueFilter#OverdueFilter',
        '/components/BulkStatusBar#BulkStatusBar',
      ],
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
  endpoints: [{ path: '/bulk-status', method: 'post', handler: bulkStatus }],
  fields: [
    {
      name: 'subject',
      type: 'text',
      required: true,
      minLength: 5,
      maxLength: 200,
      admin: {
        description:
          'A short summary of the problem, 5 to 200 characters. It is the ticket title in lists and search.',
      },
    },
    {
      name: 'description',
      type: 'richText',
      admin: {
        description:
          'The full problem as the customer reported it: steps, error messages, links. Optional.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: INITIAL_STATUS,
      options: TICKET_STATUSES.map((value) => ({ label: TICKET_STATUS_LABELS[value], value })),
      admin: {
        position: 'sidebar',
        description: describeWorkflow(),
        isClearable: false,
        components: {
          // Offers only the saved status and its allowed next steps. The hook still checks.
          Field: '/components/TicketStatusField#TicketStatusField',
        },
      },
      hooks: {
        beforeDuplicate: [() => INITIAL_STATUS],
      },
    },
    {
      name: 'priority',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'normal',
      options: TICKET_PRIORITIES.map((value) => ({ label: TICKET_PRIORITY_LABELS[value], value })),
      admin: {
        position: 'sidebar',
        description: `How fast the ticket needs an answer, counted from when it was created: ${describeDueWindows()}. Changing it moves the due date.`,
      },
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      admin: {
        position: 'sidebar',
        description:
          'The customer who reported the problem. Required. Pick an existing customer or add one with the + button.',
      },
    },
    {
      name: 'assignee',
      type: 'relationship',
      relationTo: 'users',
      // Only agents. Payload applies this in the picker and checks it again when saving.
      filterOptions: { roles: { equals: 'agent' } },
      admin: {
        position: 'sidebar',
        description:
          'The agent who works on the ticket. Required while the status is "In progress".',
      },
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      admin: {
        description:
          'Labels such as billing or outage, for filtering and reports. Pick as many as fit. Only admins create new tags.',
      },
    },
    {
      ...serverDate,
      name: 'dueAt',
      index: true,
      admin: {
        ...serverDate.admin,
        description: `Set by the server from the priority and the creation time: ${describeDueWindows()}.`,
      },
    },
    {
      name: 'isOverdue',
      type: 'checkbox',
      virtual: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description:
          'Checked when the due date has passed and the ticket is not resolved or closed. Worked out on every read, not stored.',
      },
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
      ...serverDate,
      name: 'resolvedAt',
      admin: {
        ...serverDate.admin,
        description:
          'Set by the server when the status moves to "Resolved", cleared when it is reopened.',
      },
    },
    {
      ...serverDate,
      name: 'closedAt',
      admin: {
        ...serverDate.admin,
        description: 'Set by the server when the status moves to "Closed".',
      },
    },
    {
      name: 'comments',
      type: 'array',
      labels: { singular: 'Comment', plural: 'Comments' },
      admin: {
        description:
          'Notes and replies on the ticket. The server fills in the author and time. Only the author or an admin can edit or remove a comment.',
      },
      hooks: {
        // A copy of a ticket is a new ticket. The conversation stays with the original.
        beforeDuplicate: [() => []],
      },
      fields: [
        {
          name: 'body',
          type: 'textarea',
          required: true,
          maxLength: 5000,
          admin: { description: 'The comment text, up to 5,000 characters.' },
        },
        {
          name: 'attachments',
          type: 'upload',
          relationTo: 'media',
          hasMany: true,
          maxRows: 5,
          admin: {
            description:
              'Up to 5 files: JPEG, PNG, WebP, PDF or plain text, 5 MB each. The file content must match its type.',
          },
        },
        {
          name: 'author',
          type: 'relationship',
          relationTo: 'users',
          admin: {
            readOnly: true,
            description: 'Set by the server to the person who wrote the comment.',
          },
        },
        {
          name: 'createdAt',
          type: 'date',
          admin: {
            readOnly: true,
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Set by the server when the comment is added.',
          },
        },
      ],
    },
  ],
}
