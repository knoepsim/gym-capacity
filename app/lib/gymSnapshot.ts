import type { PrismaClient } from '@prisma/client'
import { buildStableAggregatedData, buildStableTrendDirection, buildTodayForecastSeries } from './forecasting'
import { detectLikelyClosed, type ClosedStatus } from './closedStatus'
import type { DailyTrendPoint } from '@/app/components/DailyTrendChart'
import type { StableAggregatedPoint } from './forecasting'

export type GymSnapshot = {
  latest: { count: number; maxCount: number; timestamp: string } | null
  dailySeries: DailyTrendPoint[]
  trendDir: 'up' | 'down' | 'equal'
  closedStatus: ClosedStatus
  aggregated30d: StableAggregatedPoint[]
  aggregated1y: StableAggregatedPoint[]
  aggregatedAll: StableAggregatedPoint[]
  maxCapacity: number
}

function toSerializableLatest(latest: { count: number; maxCount: number; timestamp: Date } | null) {
  return latest
    ? {
        count: latest.count,
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
  const latest = await getLatestOccupancy(prisma, gymId)
  const [dailySeries, closedStatus, aggregated30d, aggregated1y, aggregatedAll, trendDir] = await Promise.all([
    buildTodayForecastSeries(prisma, gymId),
    detectLikelyClosed(prisma, gymId),
    buildStableAggregatedData(prisma, gymId, 30),
    buildStableAggregatedData(prisma, gymId, 365),
    buildStableAggregatedData(prisma, gymId),
    latest ? buildStableTrendDirection(prisma, gymId, latest.count, latest.timestamp) : Promise.resolve<'up' | 'down' | 'equal'>('equal'),
  ])

  const maxCapacity = latest?.maxCount ?? 160

  return {
    latest: toSerializableLatest(latest),
    dailySeries,
    trendDir,
    closedStatus,
    aggregated30d,
    aggregated1y,
    aggregatedAll,
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
