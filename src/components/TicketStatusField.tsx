'use client'

import { SelectField, useDocumentInfo } from '@payloadcms/ui'
import type { SelectFieldClientComponent } from 'payload'

import { allowedStatusOptions } from '../lib/statusField'

// The ticket status select on the create and edit views. It wraps Payload's own SelectField and passes it
// only the current status and the steps the workflow allows from it, so the form does not
// offer a change the server would refuse. The tickets hook still checks every change.
//
// The allowed steps come from the status that is saved, not from the value picked in the
// form: picking "In progress" must not unlock the steps after "In progress" before saving.
export const TicketStatusField: SelectFieldClientComponent = (props) => {
  const { id, savedDocumentData, initialData } = useDocumentInfo()
  // A ticket that is not saved yet has no status to move from: it starts as "New".
  const saved = id ? (savedDocumentData ?? initialData)?.status : undefined
  const { options, description } = allowedStatusOptions(props.field.options, saved)

  return (
    <SelectField
      {...props}
      readOnly={props.readOnly || !id}
      field={{
        ...props.field,
        options,
        admin: { ...props.field.admin, description } as typeof props.field.admin,
      }}
    />
  )
}
