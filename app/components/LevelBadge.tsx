'use client'

import { Popover as PopoverPrimitive } from 'radix-ui'
import { Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  OCCUPANCY_LEVEL_BADGE,
  OCCUPANCY_LEVEL_HINT,
  OCCUPANCY_LEVEL_LABEL,
  OCCUPANCY_LEVEL_RANGE,
  type OccupancyLevel,
} from '@/app/lib/occupancyLevel'

// Occupancy badge that opens a speech bubble (pointing at the badge) explaining what the level means in practice.
export function LevelBadge({ level }: { level: OccupancyLevel }) {
  const hint = OCCUPANCY_LEVEL_HINT[level]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${OCCUPANCY_LEVEL_LABEL[level]}: Bedeutung anzeigen`}
          className="cursor-pointer rounded-4xl focus-visible:outline-none"
        >
          <Badge variant={OCCUPANCY_LEVEL_BADGE[level]}>
            {OCCUPANCY_LEVEL_LABEL[level]}
            <Info data-icon="inline-end" className="opacity-70" />
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64">
        <p className="font-medium">
          {OCCUPANCY_LEVEL_LABEL[level]} <span className="font-normal text-muted-foreground">· {OCCUPANCY_LEVEL_RANGE[level]}</span>
        </p>
        <p>{hint.summary}</p>
        <p className="text-muted-foreground">{hint.advice}</p>
        <PopoverPrimitive.Arrow className="fill-popover drop-shadow-[0_1px_0_var(--color-border)]" width={14} height={7} />
      </PopoverContent>
    </Popover>
  )
}
