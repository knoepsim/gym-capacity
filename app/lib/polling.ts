import polling from '@/config/polling.json'

// The cron calls /api/fetch every baseIntervalMinutes. Gyms with a longer interval are spread over the
// runs by a stable slot per gym, so e.g. a 15 minute interval fetches a third of those gyms per run
// instead of all at once.

const REGION_INTERVALS: Record<string, number> = polling.regionIntervalMinutes

export const BASE_INTERVAL_MINUTES = polling.baseIntervalMinutes
export const REQUEST_DELAY_MS = polling.requestDelayMs
// Upper bound per run. After an outage every gym is overdue at once; the cap spreads the catch-up over
// several runs (most overdue first) instead of firing all requests in one burst.
export const MAX_REQUESTS_PER_RUN = polling.maxRequestsPerRun

export function intervalMinutesFor(region: string | null): number {
  const interval = (region ? REGION_INTERVALS[region] : undefined) ?? polling.defaultIntervalMinutes
  return Math.max(BASE_INTERVAL_MINUTES, interval)
}

function stableHash(value: string): number {
  // FNV-1a
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function isDue(gymId: string, region: string | null, lastTimestamp: Date | null, now = Date.now()): boolean {
  const interval = intervalMinutesFor(region)
  const slots = Math.max(1, Math.round(interval / BASE_INTERVAL_MINUTES))
  const run = Math.floor(now / (BASE_INTERVAL_MINUTES * 60 * 1000))
  const inSlot = run % slots === stableHash(gymId) % slots

  if (!lastTimestamp) return inSlot

  const ageMinutes = (now - lastTimestamp.getTime()) / 60000
  // Catch up when a run was missed, but never fetch more often than the interval allows.
  if (ageMinutes >= interval + BASE_INTERVAL_MINUTES) return true
  if (ageMinutes < interval - BASE_INTERVAL_MINUTES / 2) return false
  return inSlot
}

/** Due gyms of this run, most overdue (relative to their interval) first, capped at MAX_REQUESTS_PER_RUN. */
export function selectDueGyms<T extends { id: string; region: string | null }>(
  gyms: T[],
  lastTimestampByGym: Map<string, Date>,
  now = Date.now()
): T[] {
  const overdue = (gym: T) => {
    const last = lastTimestampByGym.get(gym.id)
    return last ? (now - last.getTime()) / 60000 / intervalMinutesFor(gym.region) : Number.POSITIVE_INFINITY
  }

  return gyms
    .filter((gym) => isDue(gym.id, gym.region, lastTimestampByGym.get(gym.id) ?? null, now))
    .sort((left, right) => overdue(right) - overdue(left))
    .slice(0, MAX_REQUESTS_PER_RUN)
}
