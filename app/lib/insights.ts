// Derived, user-facing statements about a gym's day. Pure functions shared by server (snapshot) and
// client (cards, detail page), so every place shows the same trend and recommendation.

export interface DaySeriesPoint {
  hour: number
  actual_count: number | null
  forecast_count: number | null
  typical_count?: number | null
}

export type TrendDirection = 'up' | 'down' | 'equal'

export interface Trend {
  direction: TrendDirection
  /** Expected change over the next two hours (persons or percentage points). */
  change: number
}

export interface BestTime {
  startHour: number
  /** Exclusive end hour. */
  endHour: number
  forecast: number
}

export function berlinHour(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).format(date)
  )
}

/**
 * Trend = average forecast of the current and the next hour compared with the current value. Changes
 * within ±3 % of the capacity (at least 1) count as steady, so small noise does not flip the arrow.
 */
export function computeTrend(series: DaySeriesPoint[], currentCount: number, maxCount: number, hour = berlinHour()): Trend | null {
  const upcoming = series.filter((point) => (point.hour === hour || point.hour === hour + 1) && point.forecast_count !== null)
  if (upcoming.length === 0) return null

  const expected = Math.round(upcoming.reduce((sum, point) => sum + (point.forecast_count ?? 0), 0) / upcoming.length)
  const change = expected - currentCount
  const tolerance = Math.max(1, Math.round(maxCount * 0.03))

  return {
    direction: change > tolerance ? 'up' : change < -tolerance ? 'down' : 'equal',
    change,
  }
}

// A recommendation always covers a full training session.
const BEST_TIME_WINDOW_HOURS = 2

/**
 * Quietest two-hour window of the rest of today according to the forecast. Hours forecast as 0 are
 * treated as closed, so a window never runs past closing time; with less than two open hours left there
 * is no recommendation.
 */
export function findBestTime(series: DaySeriesPoint[], hour = berlinHour()): BestTime | null {
  const open = new Map<number, number>()
  for (const point of series) {
    if (point.hour >= hour && point.forecast_count !== null && point.forecast_count > 0) {
      open.set(point.hour, point.forecast_count)
    }
  }

  let best: BestTime | null = null
  for (const start of [...open.keys()].sort((a, b) => a - b)) {
    const values: number[] = []
    for (let offset = 0; offset < BEST_TIME_WINDOW_HOURS; offset += 1) {
      const value = open.get(start + offset)
      if (value === undefined) break
      values.push(value)
    }
    if (values.length < BEST_TIME_WINDOW_HOURS) continue

    const forecast = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    if (!best || forecast < best.forecast) {
      best = { startHour: start, endHour: start + BEST_TIME_WINDOW_HOURS, forecast }
    }
  }

  return best
}

export type DeviationLevel = 'busier' | 'quieter' | 'usual'

export interface Deviation {
  level: DeviationLevel
  /** Usual value for this weekday and hour. */
  typical: number
  /** Relative difference of the current value to the usual one (0.25 = 25 % more). */
  ratio: number
}

// From this relative difference on, "now" is called unusually busy or quiet. About a third of all evening
// hours deviate that much, so the hint carries real information without firing constantly.
export const DEVIATION_THRESHOLD = 0.2

/**
 * Compares the current value with what is usual for this weekday and hour. Skipped when the usual value
 * is tiny (night, near closing), where relative differences are meaningless.
 */
export function computeDeviation(series: DaySeriesPoint[], currentCount: number, maxCount: number, hour = berlinHour()): Deviation | null {
  const typical = series.find((point) => point.hour === hour)?.typical_count
  if (typical === null || typical === undefined || typical < Math.max(5, maxCount * 0.05)) return null

  const ratio = (currentCount - typical) / typical
  return {
    level: ratio >= DEVIATION_THRESHOLD ? 'busier' : ratio <= -DEVIATION_THRESHOLD ? 'quieter' : 'usual',
    typical,
    ratio,
  }
}

// A recommendation needs a forecast built from at least a week of history; fewer days give flat curves.
export const MIN_HISTORY_DAYS_FOR_RECOMMENDATION = 7

const WEEKDAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

/** Short sentence for a deviation, e.g. "25 % voller als an einem typischen Mittwoch um diese Zeit". */
export function describeDeviation(deviation: Deviation, unit: 'persons' | 'percent', profileWeekday: number | null): string {
  const reference =
    profileWeekday === null ? 'üblich um diese Zeit' : `an einem typischen ${WEEKDAY_NAMES[profileWeekday]} um diese Zeit`
  const usual = unit === 'percent' ? `${deviation.typical} %` : `${deviation.typical} Personen`
  const percent = Math.round(Math.abs(deviation.ratio) * 100)

  if (deviation.level === 'busier') return `${percent} % voller als ${reference} (sonst ca. ${usual})`
  if (deviation.level === 'quieter') return `${percent} % ruhiger als ${reference} (sonst ca. ${usual})`
  return `Wie ${reference.startsWith('an ') ? reference : 'üblich um diese Zeit'} (ca. ${usual})`
}

/** Compact form for cards, e.g. "22 % voller als üblich". */
export function describeDeviationShort(deviation: Deviation): string {
  const percent = Math.round(Math.abs(deviation.ratio) * 100)
  if (deviation.level === 'busier') return `${percent} % voller als üblich`
  if (deviation.level === 'quieter') return `${percent} % ruhiger als üblich`
  return 'Wie üblich um diese Zeit'
}

export function formatHourWindow(best: BestTime): string {
  // End of day reads as 24 ("22–24 Uhr"), not 00
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(best.startHour)}–${pad(best.endHour)} Uhr`
}
