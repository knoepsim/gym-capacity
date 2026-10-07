import { PrismaClient } from '@prisma/client'
import gyms from '@/config/gyms.json'

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

function parseMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function isGym24h(gymId: string): boolean {
  const gym = (gyms as Array<{ id: string; openingHours?: Record<string, string> }>).find((g) => g.id === gymId)
  if (!gym || !gym.openingHours) return false
  return Object.values(gym.openingHours).every((v) => v === '00:00-24:00' || v === '00:00-00:00')
}

export function isOutsideOpeningHours(
  gymId: string,
  date: Date = new Date()
): { isClosed: boolean; stableMinutes: number; reason?: 'schedule' } {
  const gym = (gyms as Array<{ id: string; openingHours?: Record<string, string> }>).find((g) => g.id === gymId)
  if (!gym || !gym.openingHours) {
    return { isClosed: false, stableMinutes: 0 }
  }

  const { weekday, minutesFromMidnight } = getBerlinTimeParts(date)
  const scheduleStr = gym.openingHours[weekday]

  if (!scheduleStr || scheduleStr === 'closed') {
    return { isClosed: true, stableMinutes: 1440, reason: 'schedule' }
  }

  const parts = scheduleStr.split('-')
  if (parts.length !== 2) {
    return { isClosed: false, stableMinutes: 0 }
  }

  const openMinutes = parseMinutes(parts[0])
  const closeMinutes = parseMinutes(parts[1])

  // 24h gym case (e.g. 00:00-24:00)
  if (openMinutes === 0 && (closeMinutes >= 1440 || parts[1] === '24:00')) {
    return { isClosed: false, stableMinutes: 0 }
  }

  // Inside scheduled opening hours: [openMinutes, closeMinutes)
  if (minutesFromMidnight >= openMinutes && minutesFromMidnight < closeMinutes) {
    return { isClosed: false, stableMinutes: 0 }
  }

  // Outside scheduled opening hours
  let stableMinutes = 0
  if (minutesFromMidnight >= closeMinutes) {
    // Closed earlier today
    stableMinutes = minutesFromMidnight - closeMinutes
  } else {
    // Before opening today -> gym closed previous day
    const prevWeekday = WEEKDAY_NAMES[(WEEKDAY_NAMES.indexOf(weekday) + 6) % 7]
    const prevScheduleStr = gym.openingHours[prevWeekday]
    let prevCloseMinutes = 23 * 60 // fallback default
    if (prevScheduleStr && prevScheduleStr.includes('-')) {
      prevCloseMinutes = parseMinutes(prevScheduleStr.split('-')[1])
      if (prevCloseMinutes > 1440) prevCloseMinutes = 1440
    }
    stableMinutes = (1440 - prevCloseMinutes) + minutesFromMidnight
  }

  return { isClosed: true, stableMinutes, reason: 'schedule' }
}

export async function detectLikelyClosed(
  prisma: PrismaClient,
  gymId: string,
  referenceDate: Date = new Date()
): Promise<ClosedStatus> {
  // 1. Primary check: Scheduled opening hours from configuration
  const scheduleCheck = isOutsideOpeningHours(gymId, referenceDate)
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

  // 2. Secondary check: Dynamic stagnation / unexpected closure during scheduled hours
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

  const is24h = isGym24h(gymId)
  let isLikelyClosed = false

  if (is24h) {
    // 24h gym: only flag closed if occupancy is flat 0 for at least 180 minutes
    isLikelyClosed = newest.count === 0 && maxCount === 0 && stableMinutes >= 180
  } else {
    // Regular gym during open hours: flat 0 for >= 60 min, or frozen counter for >= CLOSED_MIN_STABLE_MINUTES
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
