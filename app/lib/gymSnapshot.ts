import type { PrismaClient } from '@prisma/client'
import { buildAggregatedFromHourly, buildTodayForecastSeries, fetchHistory, getInferredOpeningForGym } from './forecasting'
import { detectLikelyClosed, type ClosedStatus } from './closedStatus'
import { fetchHourlyRollup, updateHourlyRollup } from './hourlyRollup'
import { computeTrend } from './insights'
import { effectiveWeekday, getBerlinDateKey, getHolidays } from './holidays'
import type { DailyTrendPoint } from '@/app/components/DailyTrendChart'
import type { StableAggregatedPoint } from './forecasting'

export type GymSnapshot = {
  // count is the ghost-corrected estimate, rawCount the upstream counter value
  latest: { count: number; rawCount?: number; maxCount: number; timestamp: string } | null
  dailySeries: DailyTrendPoint[]
  trendDir: 'up' | 'down' | 'equal'
  closedStatus: ClosedStatus
  aggregated30d: StableAggregatedPoint[]
  aggregated1y: StableAggregatedPoint[]
  aggregatedAll: StableAggregatedPoint[]
  /** Days of history behind the profiles; the 1 year range only differs from "all" beyond 365. */
  historyDays?: number
  /** Weekday whose profile today's typical values come from (holidays use Sunday). */
  typicalWeekday?: number
  maxCapacity: number
}

function localDayDaysAgo(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(Date.now() - days * 86_400_000))
}

function toSerializableLatest(
  latest: { count: number; maxCount: number; timestamp: Date } | null,
  adjustedCount: number | null
) {
  return latest
    ? {
        count: adjustedCount ?? latest.count,
        rawCount: latest.count,
        maxCount: latest.maxCount,
        timestamp: latest.timestamp.toISOString(),
      }
    : null
}

async function getLatestOccupancy(prisma: PrismaClient, gymId: string) {
  return prisma.occupancy.findFirst({
    where: { gymId },
    orderBy: { timestamp: 'desc' },
  })
}

export async function computeGymSnapshot(prisma: PrismaClient, gymId: string): Promise<GymSnapshot> {
  const [latest, history] = await Promise.all([getLatestOccupancy(prisma, gymId), fetchHistory(prisma, gymId, 56)])

  const latestRow = history[history.length - 1]
  const adjustedCount =
    latest && latestRow && new Date(latestRow.timestamp).getTime() === latest.timestamp.getTime() ? latestRow.count : null
  const currentCount = adjustedCount ?? latest?.count ?? 0

  const [dailySeries, closedStatus] = await Promise.all([
    buildTodayForecastSeries(prisma, gymId, history),
    detectLikelyClosed(prisma, gymId),
  ])

  // Long-range profiles come from the hourly rollup (appended here), not from rescanning raw samples.
  await updateHourlyRollup(prisma, gymId, history)
  const [hourly, opening] = await Promise.all([fetchHourlyRollup(prisma, gymId), getInferredOpeningForGym(prisma, gymId)])
  const historyDays =
    hourly.length > 0 ? Math.ceil((Date.now() - new Date(`${hourly[0].localDay}T00:00:00Z`).getTime()) / 86_400_000) : 0
  const since30d = localDayDaysAgo(30)
  const since1y = localDayDaysAgo(365)

  const aggregatedAll = buildAggregatedFromHourly(hourly, opening)
  const aggregated30d = buildAggregatedFromHourly(hourly.filter((row) => row.localDay >= since30d), opening)
  const aggregated1y =
    historyDays > 365 ? buildAggregatedFromHourly(hourly.filter((row) => row.localDay >= since1y), opening) : aggregatedAll

  const now = new Date()
  const typicalWeekday = effectiveWeekday(
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Europe/Berlin' }).format(now)
    ),
    getBerlinDateKey(now),
    await getHolidays()
  )

  const maxCapacity = latest?.maxCount ?? 160
  const trendDir = computeTrend(dailySeries, closedStatus.isLikelyClosed ? 0 : currentCount, maxCapacity)?.direction ?? 'equal'

  return {
    latest: toSerializableLatest(latest, adjustedCount),
    dailySeries,
    trendDir,
    closedStatus,
    aggregated30d,
    aggregated1y,
    aggregatedAll,
    historyDays,
    typicalWeekday,
    maxCapacity,
  }
}

export async function upsertGymSnapshot(prisma: PrismaClient, gymId: string): Promise<GymSnapshot> {
  const snapshot = await computeGymSnapshot(prisma, gymId)

  const latestSourceTimestamp = snapshot.latest?.timestamp ? new Date(snapshot.latest.timestamp) : null

  await prisma.gymAnalyticsCache.upsert({
    where: { gymId },
    create: {
      gymId,
      sourceLatestTimestamp: latestSourceTimestamp,
      payload: snapshot as never,
    },
    update: {
      sourceLatestTimestamp: latestSourceTimestamp,
      payload: snapshot as never,
    },
  })

  return snapshot
}

export async function getCachedGymSnapshot(prisma: PrismaClient, gymId: string): Promise<GymSnapshot> {
  const cached = await prisma.gymAnalyticsCache.findUnique({ where: { gymId } })

  if (cached?.payload) {
    return cached.payload as unknown as GymSnapshot
  }

  return upsertGymSnapshot(prisma, gymId)
}
