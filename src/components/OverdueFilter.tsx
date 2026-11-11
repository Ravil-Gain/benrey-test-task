'use client'

import { Button, useListQuery } from '@payloadcms/ui'

import { overdueWhere } from '../lib/dueDate'
import './OverdueFilter.scss'

// One click to the overdue tickets: past their due date and still open. It applies the same
// rule as "Is overdue" as a list filter on the indexed columns, so no stored flag is needed.
export function OverdueFilter() {
  const { refineListData } = useListQuery()

  return (
    <div className="overdue-filter">
      <Button
        buttonStyle="pill"
        margin={false}
        onClick={() => void refineListData({ page: 1, where: overdueWhere(new Date()) })}
        size="small"
      >
        Show overdue tickets
      </Button>
      <span className="overdue-filter__hint">
        Past their due date and not resolved or closed. Remove the filter above to see all tickets
        again.
      </span>
    </div>
  )
}
