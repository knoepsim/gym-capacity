import { intervalMinutesFor } from './polling'

// A value is stale once two poll intervals passed without a new reading (plus a little slack for the
// fetch run itself), e.g. after 15 minutes in BW and 35 minutes elsewhere.
export function isStale(lastUpdate: Date | string | null, region: string | null, now = Date.now()): boolean {
  if (!lastUpdate) return false
  const ageMinutes = (now - new Date(lastUpdate).getTime()) / 60000
  return ageMinutes > intervalMinutesFor(region) * 2 + 5
}
