"use client"

import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataGrid } from '@/components/data-grid/data-grid'
import { useDataGrid } from '@/hooks/use-data-grid'

type FeedbackGridRow = {
  id: number
  createdAtLabel: string
  refName: string | null
  impression: string | null
  estimatedCount: number | null
  occupancyCount: number | null
  comment: string | null
}

interface FeedbackGymGridProps {
  entries: FeedbackGridRow[]
}

export function FeedbackGymGrid({ entries }: FeedbackGymGridProps) {
  const columns = useMemo<ColumnDef<FeedbackGridRow>[]>(
    () => [
      {
        id: 'createdAtLabel',
        accessorKey: 'createdAtLabel',
        header: 'Zeitpunkt',
        meta: { label: 'Zeitpunkt', cell: { variant: 'short-text' } },
      },
      {
        id: 'refName',
        accessorKey: 'refName',
        header: 'Von',
        meta: { label: 'Von', cell: { variant: 'short-text' } },
      },
      {
        id: 'impression',
        accessorKey: 'impression',
        header: 'Eindruck',
        meta: { label: 'Eindruck', cell: { variant: 'short-text' } },
      },
      {
        id: 'estimatedCount',
        accessorKey: 'estimatedCount',
        header: 'Geschätzt',
        meta: { label: 'Geschätzt', cell: { variant: 'number', min: 0 } },
      },
      {
        id: 'occupancyCount',
        accessorKey: 'occupancyCount',
        header: 'Zähler (roh)',
        meta: { label: 'Zähler (roh)', cell: { variant: 'number', min: 0 } },
      },
      {
        id: 'comment',
        accessorKey: 'comment',
        header: 'Anmerkung',
        meta: { label: 'Anmerkung', cell: { variant: 'long-text' } },
      },
    ],
    []
  )

  const { table, ...dataGridProps } = useDataGrid({
    data: entries,
    columns,
    getRowId: (row) => row.id.toString(),
    readOnly: true,
  })

  const gridHeight = Math.min(720, Math.max(280, entries.length * 56 + 56))

  return <DataGrid table={table} {...dataGridProps} height={gridHeight} stretchColumns />
}
