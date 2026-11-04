import type { PrismaClient } from '@prisma/client'
import { fetchHistory, withRollingGhostCorrection, type OccupancyHistoryRow } from './forecasting'
import { effectiveWeekday, getHolidays } from './holidays'

// Hourly means of the ghost-corrected occupancy. Long-range weekly profiles (30 days, 1 year, all time)
// read this table instead of scanning every raw sample on each fetch cycle. Only completed hours are
// written, so a row never changes once it exists.

const HOUR_MS = 60 * 60 * 1000
const INSERT_CHUNK = 5000

export interface HourlyRow {
  localDay: string
  weekday: number
  hour: number
  meanCount: number
  maxCount: number
}

function calendarWeekday(localDay: string): number {
  return new Date(`${localDay}T12:00:00Z`).getUTCDay()
}

/**
 * Appends all completed hours newer than the last stored one. `recentHistory` is the 56 day history the
 * snapshot already loaded; a gym without any rollup rows is backfilled once from its full history.
 */
export async function updateHourlyRollup(
  prisma: PrismaClient,
  gymId: string,
  recentHistory: OccupancyHistoryRow[],
  now = Date.now()
): Promise<number> {
  const last = await prisma.occupancyHourly.findFirst({
    where: { gymId },
    orderBy: { hourStart: 'desc' },
    select: { hourStart: true },
  })

  const rows = last ? recentHistory : await loadBackfillRows(prisma, gymId)
  const lastHour = last?.hourStart.getTime() ?? -Infinity
  const currentHourStart = Math.floor(now / HOUR_MS) * HOUR_MS

  const buckets = new Map<number, { localDay: string; hour: number; sum: number; samples: number; maxCount: number }>()
  for (const row of rows) {
    const hourStart = Math.floor(new Date(row.timestamp).getTime() / HOUR_MS) * HOUR_MS
    if (hourStart <= lastHour || hourStart >= currentHourStart) continue

    const bucket = buckets.get(hourStart) ?? { localDay: row.local_day, hour: Number(row.hour), sum: 0, samples: 0, maxCount: 0 }
    bucket.sum += Number(row.count)
    bucket.samples += 1
    bucket.maxCount = Math.max(bucket.maxCount, Number(row.max_count))
    buckets.set(hourStart, bucket)
  }

  const data = [...buckets.entries()].map(([hourStart, bucket]) => ({
    gymId,
    hourStart: new Date(hourStart),
    localDay: bucket.localDay,
    weekday: calendarWeekday(bucket.localDay),
    hour: bucket.hour,
    meanCount: bucket.sum / bucket.samples,
    samples: bucket.samples,
    maxCount: bucket.maxCount,
  }))

  for (let i = 0; i < data.length; i += INSERT_CHUNK) {
    await prisma.occupancyHourly.createMany({ data: data.slice(i, i + INSERT_CHUNK), skipDuplicates: true })
  }

  return data.length
}

// Full history for the first rollup. Counters are corrected week by week with a trailing 56 day model,
// like the live snapshot does; percentage sources are used as reported.
async function loadBackfillRows(prisma: PrismaClient, gymId: string): Promise<OccupancyHistoryRow[]> {
  const [rows, gym] = await Promise.all([
    fetchHistory(prisma, gymId),
    prisma.gym.findUnique({ where: { id: gymId }, select: { unit: true } }),
  ])
  return gym?.unit === 'percent' ? rows : withRollingGhostCorrection(rows)
}

/** Hourly rows of the last `lookbackDays` (all when omitted), with holidays mapped to Sunday. */
export async function fetchHourlyRollup(prisma: PrismaClient, gymId: string, lookbackDays?: number): Promise<HourlyRow[]> {
  const [rows, holidays] = await Promise.all([
    prisma.occupancyHourly.findMany({
      where: {
        gymId,
        ...(lookbackDays ? { hourStart: { gte: new Date(Date.now() - lookbackDays * 24 * HOUR_MS) } } : {}),
      },
      orderBy: { hourStart: 'asc' },
      select: { localDay: true, weekday: true, hour: true, meanCount: true, maxCount: true },
    }),
    getHolidays(),
  ])

  return rows.map((row) => ({ ...row, weekday: effectiveWeekday(row.weekday, row.localDay, holidays) }))
}
