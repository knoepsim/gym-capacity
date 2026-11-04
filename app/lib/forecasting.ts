import type { PrismaClient } from '@prisma/client'
import type { DailyTrendPoint } from '@/app/components/DailyTrendChart'
import { correctGhosts } from './ghostCorrection'
import { effectiveWeekday, getHolidays } from './holidays'
import type { HourlyRow } from './hourlyRollup'

export interface StableAggregatedPoint {
  weekday: number
  hour: number
  median_count: number
  max_capacity: number
}

export interface OccupancyHistoryRow {
  local_day: string
  weekday: bigint
  hour: bigint
  timestamp: Date
  count: number // ghost-corrected occupancy
  raw_count?: number // counter value as reported upstream
  max_count: number
}

interface DayBucket {
  weekday: number
  maxCapacity: number
  hourlyValues: Map<number, number[]>
  // Raw counter values: turnover (value changes) must be measured on the counter itself.
  rawHourlyValues: Map<number, number[]>
}

// Per weekday: opening window, null = closed all day, missing = unknown (not enough history yet).
export interface OpeningHours {
  [weekday: number]: { open: number; close: number; is24h?: boolean } | null | undefined
}

// A weekday is only judged once this many days of it were recorded (nearly) completely.
const MIN_COMPLETE_DAYS_PER_WEEKDAY = 2
const MIN_HOURS_FOR_COMPLETE_DAY = 20

function toNumber(value: unknown): number {
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber()
  }

  return Number(value)
}

export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)

  if (sorted.length === 0) {
    return null
  }

  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function mean(values: number[]): number | null {
  const valid = values.filter((value) => Number.isFinite(value))

  if (valid.length === 0) {
    return null
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function getBerlinHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'Europe/Berlin',
    }).format(date)
  )
}

function getBerlinDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(date)
}

function getBerlinWeekday(date: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Europe/Berlin',
  }).format(date)

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  return weekdayMap[weekday] ?? 0
}

export function detectRampStart(hourlyAverages: Array<number | null>, lowThreshold: number, maxCapacity: number): number | null {
  const risingThreshold = Math.max(4, Math.round(maxCapacity * 0.08))

  for (let hour = 4; hour <= 11; hour += 1) {
    const current = hourlyAverages[hour]
    const previous = hourlyAverages[hour - 1] ?? 0
    const previousTwo = hourlyAverages[hour - 2] ?? 0

    if (
      current !== null &&
      current >= lowThreshold &&
      previous <= lowThreshold &&
      previousTwo <= lowThreshold &&
      current - Math.max(previous, previousTwo) >= risingThreshold
    ) {
      return hour
    }
  }

  let bestHour: number | null = null
  let bestDelta = 0

  for (let hour = 4; hour <= 11; hour += 1) {
    const current = hourlyAverages[hour]
    const previous = hourlyAverages[hour - 1]

    if (current === null || previous === null) {
      continue
    }

    const delta = current - previous
    if (delta > bestDelta && delta >= risingThreshold) {
      bestDelta = delta
      bestHour = hour
    }
  }

  return bestHour
}

export function buildProfiles(rows: OccupancyHistoryRow[]): {
  weekdayHourProfile: Array<Array<number[]>>
  hourProfile: Array<number[]>
  overallProfile: number[]
  maxCapacity: number
  dayBuckets: Map<string, DayBucket>
} {
  const dayBuckets = new Map<string, DayBucket>()

  for (const row of rows) {
    const dayKey = row.local_day
    const weekday = toNumber(row.weekday)
    const hour = toNumber(row.hour)
    const count = toNumber(row.count)
    const rawCount = toNumber(row.raw_count ?? row.count)
    const maxCapacity = toNumber(row.max_count)

    const bucket = dayBuckets.get(dayKey) ?? {
      weekday,
      maxCapacity,
      hourlyValues: new Map<number, number[]>(),
      rawHourlyValues: new Map<number, number[]>(),
    }

    bucket.maxCapacity = Math.max(bucket.maxCapacity, maxCapacity)
    const values = bucket.hourlyValues.get(hour) ?? []
    values.push(count)
    bucket.hourlyValues.set(hour, values)
    const rawValues = bucket.rawHourlyValues.get(hour) ?? []
    rawValues.push(rawCount)
    bucket.rawHourlyValues.set(hour, rawValues)
    dayBuckets.set(dayKey, bucket)
  }

  const weekdayHourProfile = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => [] as number[]))
  const hourProfile = Array.from({ length: 24 }, () => [] as number[])
  const overallProfile: number[] = []
  let maxCapacity = 0

  for (const bucket of dayBuckets.values()) {
    maxCapacity = Math.max(maxCapacity, bucket.maxCapacity)
    const hourlyAverages = Array.from({ length: 24 }, (_, hour) => mean(bucket.hourlyValues.get(hour) ?? []))
    const lowThreshold = Math.max(3, Math.round(bucket.maxCapacity * 0.05))
    const rampStart = detectRampStart(hourlyAverages, lowThreshold, bucket.maxCapacity)

    for (let hour = 0; hour < 24; hour += 1) {
      const value = hourlyAverages[hour]

      if (value === null || value <= lowThreshold) {
        continue
      }

      weekdayHourProfile[bucket.weekday][hour].push(value)
      hourProfile[hour].push(value)

      if (rampStart !== null && hour >= rampStart && hour <= rampStart + 1) {
        continue
      }

      overallProfile.push(value)
    }
  }

  return { weekdayHourProfile, hourProfile, overallProfile, maxCapacity, dayBuckets }
}

export function inferOpeningHoursFromBuckets(dayBuckets: Map<string, DayBucket>): OpeningHours {
  const wdHourChanges = Array.from({ length: 7 }, () => Array(24).fill(0))
  const wdHourTotals = Array.from({ length: 7 }, () => Array(24).fill(0))
  const wdCompleteDays = Array(7).fill(0)

  for (const bucket of dayBuckets.values()) {
    const wd = bucket.weekday
    if (bucket.rawHourlyValues.size >= MIN_HOURS_FOR_COMPLETE_DAY) wdCompleteDays[wd] += 1
    for (const [h, vals] of bucket.rawHourlyValues.entries()) {
      if (vals.length > 1) {
        let ch = 0
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] !== vals[i - 1]) ch++
        }
        wdHourChanges[wd][h] += ch
        wdHourTotals[wd][h] += vals.length - 1
      }
    }
  }

  const result: OpeningHours = {}

  for (let wd = 0; wd < 7; wd++) {
    // Too little history (new gym, first partial day): unknown instead of "closed all day".
    if (wdCompleteDays[wd] < MIN_COMPLETE_DAYS_PER_WEEKDAY) continue

    const activeHours: number[] = []
    for (let h = 0; h < 24; h++) {
      const tot = wdHourTotals[wd][h]
      const ch = wdHourChanges[wd][h]
      const rate = tot > 0 ? ch / tot : 0
      // An hour is considered active if average 5-minute turnover rate >= 25%
      if (rate >= 0.25) {
        activeHours.push(h)
      }
    }

    const nightActive = [0, 1, 2, 3, 4].filter((h) => activeHours.includes(h)).length
    if (activeHours.length >= 22 && nightActive >= 3) {
      // 24h gym (e.g. Karlsruhe Süd)
      result[wd] = { open: 0, close: 23, is24h: true }
    } else if (activeHours.length > 0) {
      result[wd] = {
        open: Math.min(...activeHours),
        close: Math.max(...activeHours),
        is24h: false,
      }
    } else {
      result[wd] = null
    }
  }

  return result
}

const openingHoursCache = new Map<string, { opening: OpeningHours; expiry: number }>()

export async function getInferredOpeningForGym(
  prisma: PrismaClient,
  gymId: string
): Promise<OpeningHours> {
  const cached = openingHoursCache.get(gymId)
  if (cached && Date.now() < cached.expiry) {
    return cached.opening
  }

  const rows = await fetchHistory(prisma, gymId, 56)
  const { dayBuckets } = buildProfiles(rows)
  const opening = inferOpeningHoursFromBuckets(dayBuckets)
  openingHoursCache.set(gymId, { opening, expiry: Date.now() + 60 * 60 * 1000 })
  return opening
}

export function withinOpeningHours(opening: OpeningHours | null, weekday: number, hour: number): boolean {
  if (!opening) return true
  const w = opening[weekday]
  if (!w) return true
  if (w.is24h) return true
  return hour >= w.open && hour <= w.close
}

export function resolveProfileValue(
  weekdayHourProfile: Array<Array<number[]>>,
  hourProfile: Array<number[]>,
  overallProfile: number[],
  weekday: number,
  hour: number,
  opening: OpeningHours | null
): number {
  if (!withinOpeningHours(opening, weekday, hour)) return 0

  const weekdayMedian = median(weekdayHourProfile[weekday]?.[hour] ?? [])
  if (weekdayMedian !== null) {
    return weekdayMedian
  }

  const hourMedian = median(hourProfile[hour] ?? [])
  if (hourMedian !== null) {
    return hourMedian
  }

  return median(overallProfile) ?? 0
}

export async function fetchHistory(prisma: PrismaClient, gymId: string, lookbackDays?: number): Promise<OccupancyHistoryRow[]> {
  const rows = lookbackDays
    ? await prisma.$queryRaw<OccupancyHistoryRow[]>`
      SELECT
        TO_CHAR((("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD') as local_day,
        EXTRACT(DOW FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as weekday,
        EXTRACT(HOUR FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as hour,
        "timestamp",
        count,
        "maxCount" as max_count
      FROM "Occupancy"
      WHERE "gymId" = ${gymId}
        AND "maxCount" > 0
        AND "timestamp" >= NOW() - (${lookbackDays} * INTERVAL '1 day')
      ORDER BY "timestamp";
    `
    : await prisma.$queryRaw<OccupancyHistoryRow[]>`
      SELECT
        TO_CHAR((("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD') as local_day,
        EXTRACT(DOW FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as weekday,
        EXTRACT(HOUR FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as hour,
        "timestamp",
        count,
        "maxCount" as max_count
      FROM "Occupancy"
      WHERE "gymId" = ${gymId}
        AND "maxCount" > 0
      ORDER BY "timestamp";
    `

  const [holidays, gym] = await Promise.all([getHolidays(), prisma.gym.findUnique({ where: { id: gymId }, select: { unit: true } })])
  return finalizeHistoryRows(rows, gym?.unit === 'percent', holidays)
}

/**
 * Turns raw samples into what the forecast works with: ghost-corrected counts (not for percentage sources,
 * which have no ghosts) and holidays mapped to Sunday.
 */
export function finalizeHistoryRows(rows: OccupancyHistoryRow[], isPercentSource: boolean, holidays: Set<string>): OccupancyHistoryRow[] {
  const corrected = isPercentSource ? rows.map((row) => ({ ...row, raw_count: toNumber(row.count) })) : withGhostCorrection(rows)
  return corrected.map((row) =>
    holidays.has(row.local_day) ? { ...row, weekday: BigInt(effectiveWeekday(toNumber(row.weekday), row.local_day, holidays)) } : row
  )
}

export function withGhostCorrection(rows: OccupancyHistoryRow[]): OccupancyHistoryRow[] {
  const samples = rows.map((row) => ({
    time: new Date(row.timestamp).getTime(),
    hour: toNumber(row.hour),
    count: toNumber(row.count),
  }))
  const { adjusted } = correctGhosts(samples)

  return rows.map((row, index) => ({ ...row, raw_count: samples[index].count, count: adjusted[index] }))
}

/**
 * Ghost correction over a long history as the live system does it: every week is corrected with the model
 * fitted on the 56 days ending with that week (one model for months of data would mix seasons).
 */
export function withRollingGhostCorrection(rows: OccupancyHistoryRow[], windowDays = 56, stepDays = 7): OccupancyHistoryRow[] {
  if (rows.length === 0) return rows

  const dayMs = 86_400_000
  const samples = rows.map((row) => ({
    time: new Date(row.timestamp).getTime(),
    hour: toNumber(row.hour),
    count: toNumber(row.raw_count ?? row.count),
  }))
  const result = rows.map((row, index) => ({ ...row, raw_count: samples[index].count }))

  let windowStart = 0
  let stepStartIndex = 0
  for (let stepStart = samples[0].time; stepStartIndex < samples.length; stepStart += stepDays * dayMs) {
    const stepEnd = stepStart + stepDays * dayMs
    let stepEndIndex = stepStartIndex
    while (stepEndIndex < samples.length && samples[stepEndIndex].time < stepEnd) stepEndIndex += 1
    while (samples[windowStart].time < stepEnd - windowDays * dayMs) windowStart += 1
    if (stepEndIndex === stepStartIndex) continue

    const windowSamples = samples.slice(windowStart, stepEndIndex)
    const { adjusted } = correctGhosts(windowSamples)
    for (let i = stepStartIndex; i < stepEndIndex; i += 1) {
      result[i].count = adjusted[i - windowStart]
    }
    stepStartIndex = stepEndIndex
  }

  return result
}

// Least-squares slope of the (corrected) count over the last windows, weighted towards the shortest window.
function slopePer10MinFromRows(rows: OccupancyHistoryRow[], windows: Array<{ minutes: number; weight: number }>, nowMs = Date.now()): number {
  let aggregateSlope = 0
  let weights = 0

  for (const { minutes, weight } of windows) {
    const startMs = nowMs - minutes * 60 * 1000
    const recent: Array<{ t: number; v: number }> = []
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const t = new Date(rows[i].timestamp).getTime()
      if (t < startMs) break
      recent.push({ t: t / 60000, v: toNumber(rows[i].count) })
    }

    if (recent.length < 2) continue

    const n = recent.length
    const meanT = recent.reduce((sum, r) => sum + r.t, 0) / n
    const meanV = recent.reduce((sum, r) => sum + r.v, 0) / n
    let num = 0
    let den = 0
    for (const r of recent) {
      num += (r.t - meanT) * (r.v - meanV)
      den += (r.t - meanT) * (r.t - meanT)
    }

    aggregateSlope += (den === 0 ? 0 : num / den) * 10 * weight
    weights += weight
  }

  return weights === 0 ? 0 : aggregateSlope / weights
}

/**
 * Weekly profile (median per weekday and hour) from the hourly rollup. `opening` should be the current
 * schedule from the recent history, so old periods with other opening hours do not leak into it.
 */
export function buildAggregatedFromHourly(rows: HourlyRow[], opening: OpeningHours | null): StableAggregatedPoint[] {
  const historyRows: OccupancyHistoryRow[] = rows.map((row) => ({
    local_day: row.localDay,
    weekday: BigInt(row.weekday),
    hour: BigInt(row.hour),
    timestamp: new Date(0),
    count: row.meanCount,
    max_count: row.maxCount,
  }))
  const { weekdayHourProfile, hourProfile, overallProfile, maxCapacity } = buildProfiles(historyRows)

  return Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => ({
      weekday,
      hour,
      median_count: Math.round(resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, weekday, hour, opening)),
      max_capacity: maxCapacity,
    }))
  ).flat()
}

/**
 * How much of today's current deviation from the usual curve is carried into the following hours.
 * deltaWeights[0] applies to the next hour, [1] to the hour after, and so on; later hours use the plain
 * profile. slopeWeight scales the recent trend that is added to the next hour only.
 */
export interface ForecastTuning {
  deltaWeights: number[]
  slopeWeight: number
}

// Backtested on ghost-corrected history (6 gyms, Aug-Nov 2026, full 56 day pipeline, 11 times per hour):
// today's deviation persists much longer than the former 0.5 / 0.2 assumed. The weights are the measured
// optimum per horizon, smoothed; beyond +13 h the data runs out and the decline is simply continued.
// Together with the rolling deviation below, the mean error on Oct-Nov (not used for fitting) drops by
// 9 % at +1 h, 6 % at +2 h, 7 % at +3 h, 5 % at +4..+5 h and 4 % at +6..+13 h. Re-check with winter data.
export const FORECAST_TUNING: ForecastTuning = {
  deltaWeights: [0.7, 0.6, 0.55, 0.5, 0.45, 0.45, 0.45, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05],
  slopeWeight: 0.1,
}

/** Everything the forecast needs from the history, independent of the tuning. */
export interface TodayAnalysis {
  weekday: number
  currentHour: number
  /** Usual value for each hour of today (profile median, unrounded). */
  baselineByHour: number[]
  openByHour: boolean[]
  /** Hourly means measured so far today. */
  actualByHour: Map<number, number>
  nowcastCurrent: number | null
  currentHourSampleCount: number
  /** Current deviation from the usual curve, from the samples of the last hour (see deviationFromProfile). */
  currentDelta: number
  slopePer10Min: number
  maxCapacity: number
  opening: OpeningHours
}

/**
 * Usual value at a point in time: the hourly profile values describe the middle of their hour, so the value
 * in between is interpolated. Neighbouring hours that are closed are ignored, which keeps opening and
 * closing time from looking like a deviation.
 */
function profileAt(baselineByHour: number[], openByHour: boolean[], hourFraction: number): number {
  const hour = Math.min(23, Math.floor(hourFraction))
  const frac = hourFraction - hour

  if (frac >= 0.5) {
    const w = frac - 0.5
    const next = hour + 1 <= 23 && openByHour[hour + 1] ? baselineByHour[hour + 1] : baselineByHour[hour]
    return baselineByHour[hour] * (1 - w) + next * w
  }

  const w = frac + 0.5
  const previous = hour - 1 >= 0 && openByHour[hour - 1] ? baselineByHour[hour - 1] : baselineByHour[hour]
  return previous * (1 - w) + baselineByHour[hour] * w
}

/**
 * Deviation of the last hour's samples from the usual curve at the moment of each sample, smoothed towards the
 * newest. Comparing every sample with the profile at its own time (and not the current samples with the
 * hourly average) avoids a bias on rising or falling curves; reaching back across the hour boundary keeps the
 * estimate stable early in an hour. Needs at least two samples from open hours today.
 */
function deviationFromProfile(rows: OccupancyHistoryRow[], todayKey: string, baselineByHour: number[], openByHour: boolean[]): number {
  const deviations: number[] = []
  for (let i = rows.length - 1; i >= 0 && deviations.length < 12; i -= 1) {
    if (rows[i].local_day !== todayKey) break
    const time = new Date(rows[i].timestamp).getTime()
    // Berlin offsets are whole hours, so the minute of the UTC time is the minute of the local hour
    const hourFraction = toNumber(rows[i].hour) + (time % 3_600_000) / 3_600_000
    // Samples from closed hours are leftovers of the counter, not people: the usual value there is 0
    if (!openByHour[Math.min(23, Math.floor(hourFraction))]) continue
    deviations.unshift(toNumber(rows[i].count) - profileAt(baselineByHour, openByHour, hourFraction))
  }

  return deviations.length >= 2 ? (ewma(deviations, 0.45) ?? 0) : 0
}

function ewma(values: number[], alpha = 0.4): number | null {
  let s: number | null = null
  for (const v of values) {
    s = s === null ? v : alpha * v + (1 - alpha) * s
  }
  return s
}

export function analyzeToday(rows: OccupancyHistoryRow[], now: Date, holidays: Set<string>): TodayAnalysis {
  const { weekdayHourProfile, hourProfile, overallProfile, dayBuckets } = buildProfiles(rows)
  const opening = inferOpeningHoursFromBuckets(dayBuckets)

  const todayKey = getBerlinDateKey(now)
  const currentHour = getBerlinHour(now)
  const todayBucket = dayBuckets.get(todayKey)
  const weekday = todayBucket?.weekday ?? effectiveWeekday(getBerlinWeekday(now), todayKey, holidays)

  const actualByHour = new Map<number, number>()
  if (todayBucket) {
    for (const [hour, values] of todayBucket.hourlyValues.entries()) {
      const value = mean(values)
      if (value !== null) {
        actualByHour.set(hour, value)
      }
    }
  }

  // recent samples of the current hour (nowcast)
  const currentHourSamples = todayBucket ? (todayBucket.hourlyValues.get(currentHour) ?? []).slice(-12).map((v) => Number(v)) : []
  const nowcastCurrent = currentHourSamples.length > 0 ? ewma(currentHourSamples, 0.45) : null

  const baselineByHour = Array.from({ length: 24 }, (_, hour) =>
    resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, weekday, hour, opening)
  )
  const openByHour = Array.from({ length: 24 }, (_, hour) => withinOpeningHours(opening, weekday, hour))
  const currentDelta = deviationFromProfile(rows, todayKey, baselineByHour, openByHour)

  return {
    weekday,
    currentHour,
    baselineByHour,
    openByHour,
    actualByHour,
    nowcastCurrent,
    currentHourSampleCount: currentHourSamples.length,
    currentDelta,
    // recent slope (per 10 minutes) to nudge the short-term forecast
    slopePer10Min: slopePer10MinFromRows(rows, [{ minutes: 30, weight: 1 }], now.getTime()),
    maxCapacity: dayBuckets.values().next().value?.maxCapacity ?? 160,
    opening,
  }
}

export function assembleTodaySeries(analysis: TodayAnalysis, tuning: ForecastTuning = FORECAST_TUNING): DailyTrendPoint[] {
  const { currentHour, baselineByHour, openByHour, actualByHour, nowcastCurrent, currentHourSampleCount, currentDelta, maxCapacity } = analysis

  const maxSlopeAdj = Math.round(maxCapacity * 0.05)
  // Damped slope, bounded by +/-5% of the capacity to prevent overshooting
  const dampedSlopeAdj = Math.max(-maxSlopeAdj, Math.min(Math.round(analysis.slopePer10Min * 6 * tuning.slopeWeight), maxSlopeAdj))

  return Array.from({ length: 24 }, (_, hour) => {
    const actual = actualByHour.get(hour) ?? null
    const isOpenThisHour = openByHour[hour]
    const hoursAhead = hour - currentHour
    let forecast: number | null = null

    if (hoursAhead < 0) {
      // Past hours: NO forecast! Must strictly be null so forecast line only starts from now
      forecast = null
    } else if (!isOpenThisHour) {
      // Future hours that are closed: forecast drops to 0
      forecast = 0
    } else if (hoursAhead === 0) {
      // Current hour: anchor forecast to live actual count if available, otherwise nowcast / baseline
      const liveActual = actual !== null ? Math.round(actual) : null
      forecast = liveActual ?? (nowcastCurrent !== null && currentHourSampleCount >= 2 ? Math.round(nowcastCurrent) : Math.round(baselineByHour[currentHour]))
    } else if (hoursAhead <= tuning.deltaWeights.length) {
      // Autoregressive delta decay: part of today's current deviation carries over, mean-reverting to the profile
      const slope = hoursAhead === 1 ? dampedSlopeAdj : 0
      const projected = Math.round(baselineByHour[hour] + tuning.deltaWeights[hoursAhead - 1] * currentDelta) + slope
      forecast = Math.max(0, Math.min(projected, maxCapacity))
    } else {
      // Further future hours: use stable baseline
      forecast = Math.round(baselineByHour[hour])
    }

    return {
      hour,
      actual_count: hour > currentHour ? null : (!isOpenThisHour ? (actual !== null ? 0 : null) : (actual !== null ? Math.round(actual) : null)),
      forecast_count: forecast,
      // What this hour usually looks like on this weekday (56 day median), for comparison with today
      typical_count: isOpenThisHour ? Math.round(baselineByHour[hour]) : 0,
    }
  })
}

/** Forecast for the rest of the day as of `now`, from history rows that end at `now`. */
export function computeTodayForecast(
  rows: OccupancyHistoryRow[],
  now: Date,
  holidays: Set<string>,
  tuning: ForecastTuning = FORECAST_TUNING
): { series: DailyTrendPoint[]; opening: OpeningHours } {
  const analysis = analyzeToday(rows, now, holidays)
  return { series: assembleTodaySeries(analysis, tuning), opening: analysis.opening }
}

export async function buildTodayForecastSeries(
  prisma: PrismaClient,
  gymId: string,
  historyRows?: OccupancyHistoryRow[]
): Promise<DailyTrendPoint[]> {
  const rows = historyRows ?? (await fetchHistory(prisma, gymId, 56))
  const { series, opening } = computeTodayForecast(rows, new Date(), await getHolidays())
  openingHoursCache.set(gymId, { opening, expiry: Date.now() + 60 * 60 * 1000 })
  return series
}
