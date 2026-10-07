import { PrismaClient } from '@prisma/client'
import { getInferredOpeningForGym, type OpeningHours } from './forecasting'

export interface ClosedStatus {
  isLikelyClosed: boolean
  stableCount: number | null
  stableMinutes: number
  samples: number
  reason?: 'schedule' | 'stagnant'
}

const CLOSED_MIN_STABLE_MINUTES = Number(process.env.GYM_CLOSED_MIN_STABLE_MINUTES ?? '180')
const CLOSED_MIN_SAMPLES = Number(process.env.GYM_CLOSED_MIN_SAMPLES ?? '12')

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export type WeekdayName = (typeof WEEKDAY_NAMES)[number]

export function getBerlinTimeParts(date: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  const weekday = getPart('weekday') as WeekdayName
  const hour = Number(getPart('hour'))
  const minute = Number(getPart('minute'))

  return { weekday, hour, minute, minutesFromMidnight: hour * 60 + minute }
}

export function isGym24h(opening: OpeningHours | null): boolean {
  if (!opening) return false
  return Object.values(opening).some((day) => day?.is24h === true)
}

export function isOutsideOpeningHours(
  opening: OpeningHours | null,
  date: Date = new Date()
): { isClosed: boolean; stableMinutes: number; reason?: 'schedule' } {
  if (!opening) {
    return { isClosed: false, stableMinutes: 0 }
  }

  const { weekday, hour, minute } = getBerlinTimeParts(date)
  const weekdayIndex = WEEKDAY_NAMES.indexOf(weekday)
  const todayOpening = opening[weekdayIndex]

  if (!todayOpening) {
    return { isClosed: true, stableMinutes: hour * 60 + minute, reason: 'schedule' }
  }

  if (todayOpening.is24h) {
    return { isClosed: false, stableMinutes: 0 }
  }

  const openHour = todayOpening.open
  const closeHour = todayOpening.close + 1 // close is last active hour (e.g. 22 means 22:00-22:59, so close at 23:00)

  // Inside inferred opening hours
  if (hour >= openHour && hour < closeHour) {
    return { isClosed: false, stableMinutes: 0 }
  }

  // Outside inferred opening hours
  let stableMinutes = 0
  if (hour >= closeHour) {
    stableMinutes = (hour - closeHour) * 60 + minute
  } else {
    const prevWeekdayIndex = (weekdayIndex + 6) % 7
    const prevOpening = opening[prevWeekdayIndex]
    const prevCloseHour = prevOpening ? (prevOpening.is24h ? 24 : prevOpening.close + 1) : 23
    stableMinutes = (24 - prevCloseHour) * 60 + (hour * 60 + minute)
  }

  return { isClosed: true, stableMinutes, reason: 'schedule' }
}

export async function detectLikelyClosed(
  prisma: PrismaClient,
  gymId: string,
  referenceDate: Date = new Date(),
  inferredOpening?: OpeningHours
): Promise<ClosedStatus> {
  // 1. Primary check: Purely automated opening hours inferred from historical turnover
  const opening = inferredOpening ?? (await getInferredOpeningForGym(prisma, gymId))
  const scheduleCheck = isOutsideOpeningHours(opening, referenceDate)

  if (scheduleCheck.isClosed) {
    const latest = await prisma.occupancy.findFirst({
      where: {
        gymId,
        timestamp: { lte: referenceDate },
      },
      orderBy: { timestamp: 'desc' },
      select: { count: true, timestamp: true },
    })

    return {
      isLikelyClosed: true,
      stableCount: latest?.count ?? 0,
      stableMinutes: scheduleCheck.stableMinutes,
      samples: 0,
      reason: 'schedule',
    }
  }

  // 2. Secondary check: Dynamic stagnation / unexpected closure during open hours
  const windowStart = new Date(referenceDate.getTime() - CLOSED_MIN_STABLE_MINUTES * 60 * 1000)

  const samples = await prisma.occupancy.findMany({
    where: {
      gymId,
      timestamp: { gte: windowStart, lte: referenceDate },
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

  const counts = samples.map((sample) => sample.count)
  const minCount = Math.min(...counts)
  const maxCount = Math.max(...counts)
  const countSpread = maxCount - minCount

  const is24h = isGym24h(opening)
  let isLikelyClosed = false

  if (is24h) {
    // 24h gym: only flag closed if occupancy is flat 0 for at least 180 minutes
    isLikelyClosed = newest.count === 0 && maxCount === 0 && stableMinutes >= 180
  } else {
    // Regular gym during open hours:
    // Only flag closed if count is flat 0 for >= 60 min, or frozen counter for >= CLOSED_MIN_STABLE_MINUTES (180 min)
    if (newest.count === 0 && maxCount === 0 && stableMinutes >= 60) {
      isLikelyClosed = true
    } else if (countSpread <= 1 && stableMinutes >= CLOSED_MIN_STABLE_MINUTES && newest.count > 0) {
      isLikelyClosed = true
    }
  }

  return {
    isLikelyClosed,
    stableCount: isLikelyClosed ? newest.count : null,
    stableMinutes: isLikelyClosed ? stableMinutes : 0,
    samples: samples.length,
    reason: isLikelyClosed ? 'stagnant' : undefined,
  }
}
