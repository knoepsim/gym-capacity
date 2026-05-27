"use client"

import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataGrid } from '@/components/data-grid/data-grid'
import { useDataGrid } from '@/hooks/use-data-grid'

type FeedbackGridRow = {
  id: number
  createdAtLabel: string
  waitTimeRating: number | null
  densityRating: number | null
  wouldGoRating: number | null
  occupancyCount: number | null
  comment: string | null
  sourcePath: string | null
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
        meta: {
          label: 'Zeitpunkt',
          cell: {
            variant: 'short-text',
          },
        },
      },
      {
        id: 'waitTimeRating',
        accessorKey: 'waitTimeRating',
        header: 'Wartezeit',
        meta: {
          label: 'Wartezeit',
          cell: {
            variant: 'number',
            min: 1,
            max: 5,
          },
        },
      },
      {
        id: 'densityRating',
        accessorKey: 'densityRating',
        header: 'Dichte',
        meta: {
          label: 'Dichte',
          cell: {
            variant: 'number',
            min: 1,
            max: 5,
          },
        },
      },
      {
        id: 'wouldGoRating',
        accessorKey: 'wouldGoRating',
        header: 'Reingehen',
        meta: {
          label: 'Reingehen',
          cell: {
            variant: 'number',
            min: 1,
            max: 5,
          },
        },
      },
      {
        id: 'occupancyCount',
        accessorKey: 'occupancyCount',
        header: 'Aktuelle Belegung',
        meta: {
          label: 'Aktuelle Belegung',
          cell: {
            variant: 'number',
            min: 0,
          },
        },
      },
      {
        id: 'comment',
        accessorKey: 'comment',
        header: 'Kommentar',
        meta: {
          label: 'Kommentar',
          cell: {
            variant: 'long-text',
          },
        },
      },
      {
        id: 'sourcePath',
        accessorKey: 'sourcePath',
        header: 'Quelle',
        meta: {
          label: 'Quelle',
          cell: {
            variant: 'short-text',
          },
        },
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