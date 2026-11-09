// Shared occupancy thresholds so cards, badges and heatmaps always agree.

export type OccupancyLevel = 'low' | 'moderate' | 'high'

export function occupancyLevel(percent: number): OccupancyLevel {
  if (percent >= 80) return 'high'
  if (percent >= 50) return 'moderate'
  return 'low'
}

export const OCCUPANCY_LEVEL_LABEL: Record<OccupancyLevel, string> = {
  low: 'Wenig los',
  moderate: 'Moderat',
  high: 'Sehr voll',
}

export const OCCUPANCY_LEVEL_RANGE: Record<OccupancyLevel, string> = {
  low: 'unter 50 %',
  moderate: '50–80 %',
  high: 'über 80 %',
}

/** What the level means in practice, shown in the explainer bubble next to the badge. */
export const OCCUPANCY_LEVEL_HINT: Record<OccupancyLevel, { summary: string; advice: string }> = {
  low: {
    summary: 'Wenig ausgelastet. Du bekommst jedes Gerät sofort und hast viel Platz.',
    advice: 'Ein guter Zeitpunkt zum Trainieren.',
  },
  moderate: {
    summary: 'Mittel ausgelastet. An einzelnen Geräten wartest du kurz, aber nicht lange.',
    advice: 'Bei dieser Auslastung würde ich kommen.',
  },
  high: {
    summary: 'Sehr voll. An vielen Geräten, vor allem an Racks und Kardio, musst du warten.',
    advice: 'Wenn du flexibel bist, komm später oder schau dir die beste Zeit an.',
  },
}

export const OCCUPANCY_LEVEL_BADGE = {
  low: 'success',
  moderate: 'warning',
  high: 'critical',
} as const satisfies Record<OccupancyLevel, 'success' | 'warning' | 'critical'>

/** Tinted surface for heatmap cells, built from the semantic level tokens. */
export const OCCUPANCY_LEVEL_SURFACE: Record<OccupancyLevel, string> = {
  low: 'bg-success/15',
  moderate: 'bg-warning/25',
  high: 'bg-destructive/20',
}
