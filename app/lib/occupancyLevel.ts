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
