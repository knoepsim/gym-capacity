import { PrismaClient } from '@prisma/client'
import { type DailyTrendPoint } from '@/app/components/DailyTrendChart'

export interface StableAggregatedPoint {
  weekday: number
  hour: number
  median_count: number
  max_capacity: number
}

interface OccupancyHistoryRow {
  local_day: string
  weekday: bigint
  hour: bigint
  count: number
  max_count: number
}

interface DayBucket {
  weekday: number
  maxCapacity: number
  hourlyValues: Map<number, number[]>
}

export interface OpeningHours {
  [weekday: number]: { open: number; close: number; is24h?: boolean } | null
}

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
    const maxCapacity = toNumber(row.max_count)

    const bucket = dayBuckets.get(dayKey) ?? {
      weekday,
      maxCapacity,
      hourlyValues: new Map<number, number[]>(),
    }

    bucket.maxCapacity = Math.max(bucket.maxCapacity, maxCapacity)
    const values = bucket.hourlyValues.get(hour) ?? []
    values.push(count)
    bucket.hourlyValues.set(hour, values)
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

  for (const bucket of dayBuckets.values()) {
    const wd = bucket.weekday
    for (const [h, vals] of bucket.hourlyValues.entries()) {
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
  if (lookbackDays) {
    return prisma.$queryRaw<OccupancyHistoryRow[]>`
      SELECT
        TO_CHAR((("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD') as local_day,
        EXTRACT(DOW FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as weekday,
        EXTRACT(HOUR FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as hour,
        count,
        "maxCount" as max_count
      FROM "Occupancy"
      WHERE "gymId" = ${gymId}
        AND "timestamp" >= NOW() - (${lookbackDays} * INTERVAL '1 day')
      ORDER BY local_day, hour, "timestamp";
    `
  }

  return prisma.$queryRaw<OccupancyHistoryRow[]>`
    SELECT
      TO_CHAR((("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD') as local_day,
      EXTRACT(DOW FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as weekday,
      EXTRACT(HOUR FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as hour,
      count,
      "maxCount" as max_count
    FROM "Occupancy"
    WHERE "gymId" = ${gymId}
    ORDER BY local_day, hour, "timestamp";
  `
}

export async function buildStableAggregatedData(
  prisma: PrismaClient,
  gymId: string,
  lookbackDays?: number
): Promise<StableAggregatedPoint[]> {
  const rows = await fetchHistory(prisma, gymId, lookbackDays)
  const { weekdayHourProfile, hourProfile, overallProfile, maxCapacity, dayBuckets } = buildProfiles(rows)
  const inferredOpening = inferOpeningHoursFromBuckets(dayBuckets)

  return Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => ({
      weekday,
      hour,
      median_count: Math.round(resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, weekday, hour, inferredOpening)),
      max_capacity: maxCapacity,
    }))
  ).flat()
}

export async function buildTodayForecastSeries(prisma: PrismaClient, gymId: string): Promise<DailyTrendPoint[]> {
  const rows = await fetchHistory(prisma, gymId, 56)
  const { weekdayHourProfile, hourProfile, overallProfile, dayBuckets } = buildProfiles(rows)

  const inferredOpening = inferOpeningHoursFromBuckets(dayBuckets)
  openingHoursCache.set(gymId, { opening: inferredOpening, expiry: Date.now() + 60 * 60 * 1000 })

  const todayKey = getBerlinDateKey(new Date())
  const currentHourBerlin = getBerlinHour(new Date())
  const todayBucket = dayBuckets.get(todayKey)
  const todayWeekday = todayBucket?.weekday ?? getBerlinWeekday(new Date())

  // compute recent slope (per 10 minutes) from DB to nudge short-term forecast
  const windowMinutes = 30
  const recentRows = await prisma.$queryRaw<{ count: number; timestamp: Date }[]>`
    SELECT count, "timestamp" FROM "Occupancy"
    WHERE "gymId" = ${gymId} AND "timestamp" >= NOW() - (${windowMinutes} * INTERVAL '1 minute')
    ORDER BY "timestamp" ASC
  `

  let slopePer10Min = 0
  if (recentRows && recentRows.length >= 3) {
    const times = recentRows.map((r) => new Date(r.timestamp).getTime() / 60000) // minutes
    const vals = recentRows.map((r) => Number(r.count))
    const n = vals.length
    const meanT = times.reduce((a, b) => a + b, 0) / n
    const meanV = vals.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (times[i] - meanT) * (vals[i] - meanV)
      den += (times[i] - meanT) * (times[i] - meanT)
    }
    const slopePerMinute = den === 0 ? 0 : num / den
    slopePer10Min = slopePerMinute * 10
  }

  const actualByHour = new Map<number, number>()
  if (todayBucket) {
    for (const [hour, values] of todayBucket.hourlyValues.entries()) {
      const value = mean(values)
      if (value !== null) {
        actualByHour.set(hour, value)
      }
    }
  }

  function ewma(values: number[], alpha = 0.4) {
    let s: number | null = null
    for (const v of values) {
      if (s === null) s = v
      else s = alpha * v + (1 - alpha) * s
    }
    return s ?? null
  }
  // prepare recent samples for current hour (for nowcast)
  const currentHourSamples = todayBucket ? (todayBucket.hourlyValues.get(currentHourBerlin) ?? []).slice(-12).map((v) => Number(v)) : []
  const nowcastCurrent = currentHourSamples.length > 0 ? ewma(currentHourSamples, 0.45) : null

  const baselineCurrent = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, todayWeekday, currentHourBerlin, inferredOpening)
  const currentDelta = nowcastCurrent !== null && currentHourSamples.length >= 2 ? nowcastCurrent - baselineCurrent : 0
  const maxCapacity = dayBuckets.values().next().value?.maxCapacity ?? 160
  const maxSlopeAdj = Math.round(maxCapacity * 0.05)
  // Damp slope (0.2 factor) and bound by +/-5% max capacity to prevent overshooting
  const dampedSlopeAdj = Math.max(-maxSlopeAdj, Math.min(Math.round(slopePer10Min * 6 * 0.2), maxSlopeAdj))

  return Array.from({ length: 24 }, (_, hour) => {
    const actual = actualByHour.get(hour) ?? null
    const isOpenThisHour = withinOpeningHours(inferredOpening, todayWeekday, hour)
    let forecast: number | null = null

    if (hour < currentHourBerlin) {
      // Past hours: NO forecast! Must strictly be null so forecast line only starts from now
      forecast = null
    } else if (!isOpenThisHour) {
      // Future hours that are closed: forecast drops to 0
      forecast = 0
    } else if (hour === currentHourBerlin) {
      // Current hour: anchor forecast to live actual count if available, otherwise nowcast / baseline
      const liveActual = actual !== null ? Math.round(actual) : null
      forecast = liveActual ?? (nowcastCurrent !== null && currentHourSamples.length >= 2 ? Math.round(nowcastCurrent) : Math.round(baselineCurrent))
    } else if (hour === currentHourBerlin + 1) {
      // Next hour: autoregressive delta decay (50% of today's current deviation) + bounded micro-slope
      const baseline = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, todayWeekday, hour, inferredOpening)
      const projected = Math.round(baseline + 0.5 * currentDelta) + dampedSlopeAdj
      forecast = Math.max(0, Math.min(projected, maxCapacity))
    } else if (hour === currentHourBerlin + 2) {
      // +2h: autoregressive delta decay (20% of today's current deviation) mean-reverting toward baseline
      const baseline = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, todayWeekday, hour, inferredOpening)
      const projected = Math.round(baseline + 0.2 * currentDelta)
      forecast = Math.max(0, Math.min(projected, maxCapacity))
    } else {
      // Further future hours: use stable baseline
      const base = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, todayWeekday, hour, inferredOpening)
      forecast = Math.round(base)
    }

    return {
      hour,
      actual_count: hour > currentHourBerlin ? null : (!isOpenThisHour ? (actual !== null ? 0 : null) : (actual !== null ? Math.round(actual) : null)),
      forecast_count: forecast,
    }
  })
}

export async function buildStableTrendDirection(
  prisma: PrismaClient,
  gymId: string,
  currentCount: number,
  timestamp: Date,
  fallbackTolerance = 0.08
): Promise<'up' | 'down' | 'equal'> {
  // compute minute-based slope over multiple windows for robust detection
  const windows = [10, 30, 60] // minutes
  let aggregateSlope = 0
  let weights = 0
  for (const windowMinutes of windows) {
    const recent = await prisma.$queryRaw<{ count: number; timestamp: Date }[]>`
      SELECT count, "timestamp" FROM "Occupancy"
      WHERE "gymId" = ${gymId} AND "timestamp" >= NOW() - (${windowMinutes} * INTERVAL '1 minute')
      ORDER BY "timestamp" ASC
    `

    if (!recent || recent.length < 2) continue

    const times = recent.map((r) => new Date(r.timestamp).getTime() / 60000) // minutes
    const vals = recent.map((r) => Number(r.count))
    const n = vals.length
    const meanT = times.reduce((a, b) => a + b, 0) / n
    const meanV = vals.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (times[i] - meanT) * (vals[i] - meanV)
      den += (times[i] - meanT) * (times[i] - meanT)
    }
    const slopePerMinute = den === 0 ? 0 : num / den
    const slopePer10Min = slopePerMinute * 10
    const w = windowMinutes === 10 ? 3 : windowMinutes === 30 ? 2 : 1
    aggregateSlope += slopePer10Min * w
    weights += w
  }

  const slopePer10Min = weights === 0 ? 0 : aggregateSlope / weights

  // baseline expectation for current hour
  const rows = await fetchHistory(prisma, gymId, 56)
  const { weekdayHourProfile, hourProfile, overallProfile, dayBuckets } = buildProfiles(rows)
  const inferredOpening = inferOpeningHoursFromBuckets(dayBuckets)
  openingHoursCache.set(gymId, { opening: inferredOpening, expiry: Date.now() + 60 * 60 * 1000 })
  const weekday = getBerlinWeekday(timestamp)
  const hour = getBerlinHour(timestamp)

  if (!withinOpeningHours(inferredOpening, weekday, hour)) return 'equal'

  const expected = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, weekday, hour, inferredOpening)
  const tolerance = Math.max(3, expected * fallbackTolerance)
  if (currentCount > expected + tolerance && slopePer10Min > 1) return 'up'
  if (currentCount < expected - tolerance && slopePer10Min < -1) return 'down'
  return 'equal'
}

// exported helper: compute slope per 10 minutes for a gym using multiple windows
export async function computeSlopePer10Min(prisma: PrismaClient, gymId: string): Promise<number> {
  const windows = [10, 30, 60]
  let aggregateSlope = 0
  let weights = 0
  for (const windowMinutes of windows) {
    const recent = await prisma.$queryRaw<{ count: number; timestamp: Date }[]>`
      SELECT count, "timestamp" FROM "Occupancy"
      WHERE "gymId" = ${gymId} AND "timestamp" >= NOW() - (${windowMinutes} * INTERVAL '1 minute')
      ORDER BY "timestamp" ASC
    `
    if (!recent || recent.length < 2) continue
    const times = recent.map((r) => new Date(r.timestamp).getTime() / 60000)
    const vals = recent.map((r) => Number(r.count))
    const n = vals.length
    const meanT = times.reduce((a, b) => a + b, 0) / n
    const meanV = vals.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (times[i] - meanT) * (vals[i] - meanV)
      den += (times[i] - meanT) * (times[i] - meanT)
    }
    const slopePerMinute = den === 0 ? 0 : num / den
    const slopePer10Min = slopePerMinute * 10
    const w = windowMinutes === 10 ? 3 : windowMinutes === 30 ? 2 : 1
    aggregateSlope += slopePer10Min * w
    weights += w
  }
  return weights === 0 ? 0 : aggregateSlope / weights
}
