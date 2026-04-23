import { PrismaClient } from '@prisma/client'

export interface ClosedStatus {
  isLikelyClosed: boolean
  stableCount: number | null
  stableMinutes: number
  samples: number
}

const CLOSED_MIN_STABLE_MINUTES = Number(process.env.GYM_CLOSED_MIN_STABLE_MINUTES ?? '360')
const CLOSED_MIN_SAMPLES = Number(process.env.GYM_CLOSED_MIN_SAMPLES ?? '24')

export async function detectLikelyClosed(
  prisma: PrismaClient,
  gymId: string
): Promise<ClosedStatus> {
  const windowStart = new Date(Date.now() - CLOSED_MIN_STABLE_MINUTES * 60 * 1000)

  const samples = await prisma.occupancy.findMany({
    where: {
      gymId,
      timestamp: { gte: windowStart },
    },
    orderBy: { timestamp: 'desc' },
    select: {
      count: true,
      timestamp: true,
    },
  })

  if (samples.length < CLOSED_MIN_SAMPLES) {
    return {
      isLikelyClosed: false,
      stableCount: null,
      stableMinutes: 0,
      samples: samples.length,
    }
  }

  const newest = samples[0]
  const oldest = samples[samples.length - 1]
  const stableMinutes = Math.floor(
    (new Date(newest.timestamp).getTime() - new Date(oldest.timestamp).getTime()) / 60000
  )

  const distinctCounts = new Set(samples.map((sample) => sample.count))
  const stableCount = newest.count
  const isLikelyClosed =
    distinctCounts.size === 1 && stableMinutes >= CLOSED_MIN_STABLE_MINUTES && stableCount > 0

  return {
    isLikelyClosed,
    stableCount,
    stableMinutes,
    samples: samples.length,
  }
}
