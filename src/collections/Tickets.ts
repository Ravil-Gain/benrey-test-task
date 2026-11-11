import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '../lib/access'
import { describeDueWindows, isOverdue, TICKET_PRIORITIES } from '../lib/dueDate'
import {
  describeWorkflow,
  INITIAL_STATUS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketStatus,
} from '../lib/ticketStatus'
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
      admin: {
        description: 'A short summary of the problem, 5 to 200 characters. It is the ticket title in lists and search.',
      },
    },
    {
      name: 'description',
      type: 'richText',
      admin: {
        description: 'The full problem as the customer reported it: steps, error messages, links. Optional.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: INITIAL_STATUS,
      options: TICKET_STATUSES.map((value) => ({ label: TICKET_STATUS_LABELS[value], value })),
      // The transition rules are checked in beforeTicketChange, not here. The form only
      // keeps people from picking a status the server would refuse.
      admin: {
        position: 'sidebar',
        // The form replaces this with a hint for the ticket's own next steps. The AI help
        // reads this full version.
        description: describeWorkflow(),
        // A ticket always has a status, so the select has no clear button.
        isClearable: false,
        components: {
          // Offers the current status and the allowed next steps only. On the create form
          // it shows "New" read-only. (An admin.condition would hide it too, but Payload then
          // treats the column as nullable and drops its NOT NULL constraint.)
          Field: '/components/TicketStatusField#TicketStatusField',
        },
      },
      hooks: {
        // A copy is a new ticket, so it starts as "New" too.
        beforeDuplicate: [() => INITIAL_STATUS],
      },
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
      admin: {
        position: 'sidebar',
        description: `How fast the ticket needs an answer. It sets the due date when the ticket is created: ${describeDueWindows()}. Changing it later does not move the due date.`,
      },
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      admin: {
        position: 'sidebar',
        description: 'The customer who reported the problem. Required. Pick an existing customer or add one with the + button.',
      },
    },
    {
      name: 'assignee',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        position: 'sidebar',
        description: 'The agent who works on the ticket. Needed before the status can move to "In progress".',
      },
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      admin: {
        description: 'Labels such as billing or outage, for filtering and reports. Pick as many as fit. Only admins create new tags.',
      },
    },
    {
      name: 'dueAt',
      type: 'date',
      admin: {
        ...serverDate,
        description: `Set by the server when the ticket is created, from the priority: ${describeDueWindows()}.`,
      },
    },
    {
      // Not stored. Worked out every time the ticket is read.
      name: 'isOverdue',
      type: 'checkbox',
      virtual: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Checked when the due date has passed and the ticket is not resolved or closed. Worked out on every read, not stored.',
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
      name: 'resolvedAt',
      type: 'date',
      admin: { ...serverDate, description: 'Set by the server when the status moves to "Resolved".' },
      hooks: { beforeDuplicate: [() => null] },
    },
    {
      name: 'closedAt',
      type: 'date',
      admin: { ...serverDate, description: 'Set by the server when the status moves to "Closed".' },
      hooks: { beforeDuplicate: [() => null] },
    },
    {
      name: 'comments',
      type: 'array',
      labels: { singular: 'Comment', plural: 'Comments' },
      admin: {
        description: 'Notes and replies on the ticket. Add and edit them right here. The server fills in the author and time.',
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
            description: 'Up to 5 files: JPEG, PNG, WebP, PDF or plain text, 5 MB each. The file content must match its type.',
          },
        },
        {
          name: 'author',
          type: 'relationship',
          relationTo: 'users',
          admin: { readOnly: true, description: 'Set by the server to the person who wrote the comment.' },
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
