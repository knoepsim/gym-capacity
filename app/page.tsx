export const dynamic = 'force-dynamic';
import { PrismaClient } from '@prisma/client'
import { GymCard } from './components/GymCard'
import gyms from '@/config/gyms.json'
import { detectLikelyClosed } from './lib/closedStatus'
import { Badge } from '@/components/ui/badge'
import { type DailyTrendPoint } from '@/app/components/DailyTrendChart'

const prisma = new PrismaClient()

const GYM_CONFIG_BY_ID = Object.fromEntries(gyms.map((gym) => [gym.id, gym])) as Record<
  string,
  (typeof gyms)[number]
>

interface HourlyActualData {
  hour: bigint
  actual_count: number
}

interface HourlyForecastData {
  hour: bigint
  forecast_count: number
}

function toPlainNumber(value: unknown): number {
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber()
  }

  return Number(value)
}

async function getLatestOccupancy(gymId: string) {
  try {
    const latest = await prisma.occupancy.findFirst({
      where: { gymId },
      orderBy: { timestamp: 'desc' },
    })
    return latest
  } catch (error) {
    console.error('Fehler beim Abrufen der neuesten Auslastung:', error)
    return null
  }
}

async function getAllGyms() {
  try {
    return await prisma.gym.findMany({
      orderBy: { name: 'asc' },
    })
  } catch (error) {
    console.error('Fehler beim Abrufen der Gyms:', error)
    return []
  }
}

async function getGymTodaySeries(gymId: string): Promise<DailyTrendPoint[]> {
  try {
    const currentHourBerlin = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Europe/Berlin',
      }).format(new Date())
    )

    const [actualRows, forecastRows] = await Promise.all([
      prisma.$queryRaw<HourlyActualData[]>`
        WITH localized_occupancy AS (
          SELECT
            (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin') as local_timestamp,
            count
          FROM "Occupancy"
          WHERE "gymId" = ${gymId}
            AND DATE((("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) =
                DATE((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin'))
        )
        SELECT
          EXTRACT(HOUR FROM local_timestamp) as hour,
          ROUND(AVG(count)::numeric, 2) as actual_count
        FROM localized_occupancy
        GROUP BY EXTRACT(HOUR FROM local_timestamp)
        ORDER BY hour;
      `,
      prisma.$queryRaw<HourlyForecastData[]>`
        WITH localized_occupancy AS (
          SELECT
            (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin') as local_timestamp,
            count
          FROM "Occupancy"
          WHERE "gymId" = ${gymId}
            AND DATE((("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) <
                DATE((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin'))
            AND EXTRACT(DOW FROM (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) =
                EXTRACT(DOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin'))
        )
        SELECT
          EXTRACT(HOUR FROM local_timestamp) as hour,
          ROUND(AVG(count)::numeric, 2) as forecast_count
        FROM localized_occupancy
        GROUP BY EXTRACT(HOUR FROM local_timestamp)
        ORDER BY hour;
      `,
    ])

    const actualByHour = new Map(actualRows.map((row) => [Number(row.hour), toPlainNumber(row.actual_count)]))
    const forecastByHour = new Map(forecastRows.map((row) => [Number(row.hour), toPlainNumber(row.forecast_count)]))

    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      actual_count: actualByHour.get(hour) ?? null,
      forecast_count: hour > currentHourBerlin ? (forecastByHour.get(hour) ?? null) : null,
    }))
  } catch (error) {
    console.error('Fehler beim Abrufen der Tagesdaten:', error)
    return Array.from({ length: 24 }, (_, hour) => ({ hour, actual_count: null, forecast_count: null }))
  }
}


export default async function HomePage() {
  const gyms = await getAllGyms()
  // Debug: Logge die Gyms
  console.log('GYMS FROM PRISMA:', gyms)

  // Hole aktuelle Auslastung und Tages-Statistik für alle Gyms
  const gymData = await Promise.all(
    gyms.map(async (gym) => {
      const [latest, dailySeries, closedStatus] = await Promise.all([
        getLatestOccupancy(gym.id),
        getGymTodaySeries(gym.id),
        detectLikelyClosed(prisma, gym.id),
      ])
      // Trend: Vergleiche aktuellen Wert mit vorletztem Wert
      let trendDir: 'up' | 'down' | 'equal' = 'equal';
      if (latest) {
        const prev = await prisma.occupancy.findFirst({
          where: { gymId: gym.id, timestamp: { lt: latest.timestamp } },
          orderBy: { timestamp: 'desc' },
        });
        if (prev) {
          if (latest.count > prev.count) trendDir = 'up';
          else if (latest.count < prev.count) trendDir = 'down';
        }
      }
      return {
        ...gym,
        latest,
        dailySeries,
        trendDir,
        closedStatus,
      }
    })
  )
  // Debug: Logge gymData
  console.log('GYM DATA FOR RENDER:', gymData)

  const closedCount = gymData.filter((gym) => gym.closedStatus?.isLikelyClosed).length

  return (
    <main className="min-h-screen">
      <div className="border-b border-border/70 bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Gym Auslastung</h1>
          <p className="max-w-2xl text-muted-foreground">Auslastung in allen Gyms mit Trend</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge className="rounded-md">{gymData.length} Studios</Badge>
            <Badge variant="outline" className="rounded-md">{closedCount} als geschlossen erkannt</Badge>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {gymData.map((gym) => (
            <div key={gym.id} className="flex flex-col">
              <GymCard
                id={gym.id}
                name={gym.name}
                currentCount={gym.latest?.count ?? 0}
                maxCount={GYM_CONFIG_BY_ID[gym.id]?.maxCapacity ?? gym.latest?.maxCount ?? 160}
                lastUpdate={gym.latest?.timestamp ?? new Date()}
                dailySeries={gym.dailySeries ?? []}
                isLikelyClosed={gym.closedStatus?.isLikelyClosed ?? false}
                closedStableMinutes={gym.closedStatus?.stableMinutes ?? 0}
              />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
