// Public holidays in Baden-Württemberg. Gyms usually keep Sunday hours on holidays, so holidays are
// treated as Sundays for opening hours, profiles and forecasts.

const HOLIDAY_API_URL = 'https://get.api-feiertage.de'
const HOLIDAY_STATE = 'bw'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000

interface HolidayApiResponse {
  status?: string
  feiertage?: Array<{ date?: string } & Record<string, unknown>>
}

let cache: { dates: Set<string>; expiry: number } | null = null
let pending: Promise<Set<string>> | null = null

async function loadHolidays(): Promise<Set<string>> {
  const year = new Date().getFullYear()
  const years = [year - 1, year, year + 1].join(',')
  const response = await fetch(`${HOLIDAY_API_URL}?years=${years}&states=${HOLIDAY_STATE}`, {
    signal: AbortSignal.timeout(5000),
    headers: { 'User-Agent': 'GymCapacityMonitor/1.0' },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const data = (await response.json()) as HolidayApiResponse
  if (data.status !== 'success' || !Array.isArray(data.feiertage)) {
    throw new Error('Invalid holiday response')
  }

  return new Set(
    data.feiertage
      .filter((holiday) => holiday[HOLIDAY_STATE] === '1' && typeof holiday.date === 'string')
      .map((holiday) => holiday.date as string)
  )
}

/** Holiday dates as Berlin-local 'YYYY-MM-DD'. Never throws: falls back to the last known (or no) holidays. */
export async function getHolidays(): Promise<Set<string>> {
  if (cache && Date.now() < cache.expiry) {
    return cache.dates
  }

  pending ??= loadHolidays()
    .then((dates) => {
      cache = { dates, expiry: Date.now() + CACHE_TTL_MS }
      return dates
    })
    .catch((error) => {
      console.error('Feiertage konnten nicht geladen werden:', error)
      const dates = cache?.dates ?? new Set<string>()
      cache = { dates, expiry: Date.now() + RETRY_AFTER_FAILURE_MS }
      return dates
    })
    .finally(() => {
      pending = null
    })

  return pending
}

export function getBerlinDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(date)
}

/** Weekday (0 = Sunday) used for opening hours and profiles: holidays count as Sunday. */
export function effectiveWeekday(weekday: number, dateKey: string, holidays: Set<string>): number {
  return holidays.has(dateKey) ? 0 : weekday
}
