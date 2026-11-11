'use client'

import { SelectField, useDocumentInfo } from '@payloadcms/ui'
import type { SelectFieldClientComponent } from 'payload'

import { allowedStatusOptions } from '../lib/statusField'

// Payload's own select, given only the saved status and the steps the workflow allows from
// it. The steps come from the saved status, not the value picked in the form, so picking
// "In progress" does not unlock the steps after it before saving. The hook still checks.
export const TicketStatusField: SelectFieldClientComponent = (props) => {
  const { id, savedDocumentData, initialData } = useDocumentInfo()
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
