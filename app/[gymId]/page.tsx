import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GymAnalyticsClient } from './GymAnalyticsClient'
import gyms from '@/config/gyms.json'
import { detectLikelyClosed } from '@/app/lib/closedStatus'

const prisma = new PrismaClient()

const GYM_CONFIG_BY_ID = Object.fromEntries(gyms.map((gym) => [gym.id, gym])) as Record<
  string,
  (typeof gyms)[number]
>

interface AggregatedData {
  weekday: bigint
  hour: bigint
  median_count: number
  max_capacity: number
}

type RangeKey = '30D' | '1Y' | 'ALL'

interface PageProps {
  params: Promise<{
    gymId: string
  }>
}

async function getAggregatedData(gymId: string, range: RangeKey) {
  try {
    let rawData: AggregatedData[]

    if (range === 'ALL') {
      rawData = await prisma.$queryRaw<AggregatedData[]>`
        WITH localized_occupancy AS (
          SELECT
            (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin') as local_timestamp,
            count,
            "maxCount"
          FROM "Occupancy"
          WHERE "gymId" = ${gymId}
        )
        SELECT
          EXTRACT(DOW FROM local_timestamp) as weekday,
          EXTRACT(HOUR FROM local_timestamp) as hour,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY count) as median_count,
          MAX("maxCount") as max_capacity
        FROM localized_occupancy
        GROUP BY EXTRACT(DOW FROM local_timestamp), EXTRACT(HOUR FROM local_timestamp)
        ORDER BY weekday, hour;
      `
    } else if (range === '1Y') {
      rawData = await prisma.$queryRaw<AggregatedData[]>`
        WITH localized_occupancy AS (
          SELECT
            (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin') as local_timestamp,
            count,
            "maxCount"
          FROM "Occupancy"
          WHERE "gymId" = ${gymId}
            AND "timestamp" > NOW() - INTERVAL '1 year'
        )
        SELECT
          EXTRACT(DOW FROM local_timestamp) as weekday,
          EXTRACT(HOUR FROM local_timestamp) as hour,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY count) as median_count,
          MAX("maxCount") as max_capacity
        FROM localized_occupancy
        GROUP BY EXTRACT(DOW FROM local_timestamp), EXTRACT(HOUR FROM local_timestamp)
        ORDER BY weekday, hour;
      `
    } else {
      rawData = await prisma.$queryRaw<AggregatedData[]>`
        WITH localized_occupancy AS (
          SELECT
            (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin') as local_timestamp,
            count,
            "maxCount"
          FROM "Occupancy"
          WHERE "gymId" = ${gymId}
            AND "timestamp" > NOW() - INTERVAL '30 days'
        )
        SELECT
          EXTRACT(DOW FROM local_timestamp) as weekday,
          EXTRACT(HOUR FROM local_timestamp) as hour,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY count) as median_count,
          MAX("maxCount") as max_capacity
        FROM localized_occupancy
        GROUP BY EXTRACT(DOW FROM local_timestamp), EXTRACT(HOUR FROM local_timestamp)
        ORDER BY weekday, hour;
      `
    }

    return rawData.map((item: any) => ({
      weekday: Number(item.weekday),
      hour: Number(item.hour),
      median_count: typeof item.median_count === 'string' ? parseFloat(item.median_count) : item.median_count,
      max_capacity: Number(item.max_capacity),
    }))
  } catch (error) {
    console.error('Fehler beim Abrufen der aggregierten Daten:', error)
    return []
  }
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

async function getGymInfo(gymId: string) {
  try {
    return await prisma.gym.findUnique({
      where: { id: gymId },
    })
  } catch (error) {
    console.error('Fehler beim Abrufen der Gym-Info:', error)
    return null
  }
}

export default async function GymDetailPage({ params }: PageProps) {
  const { gymId } = await params

  // Avoid treating static file-like paths (e.g. /logo.png) as gym IDs.
  if (gymId.includes('.')) {
    notFound()
  }

  const gymInfo = await getGymInfo(gymId)

  if (!gymInfo) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="bg-white rounded-xl shadow-lg p-10 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Studio nicht gefunden</h1>
            <p className="text-gray-600 mb-8">
              Für die Gym-ID "{gymId}" gibt es kein Studio. Bitte prüfe den Link oder gehe zurück zur Übersicht.
            </p>
            <Link
              href="/"
              className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-3 text-white font-semibold hover:bg-blue-700 transition-colors"
            >
              Zur Startseite
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const [data30d, data1y, dataAll, latestOccupancy, closedStatus] = await Promise.all([
    getAggregatedData(gymId, '30D'),
    getAggregatedData(gymId, '1Y'),
    getAggregatedData(gymId, 'ALL'),
    getLatestOccupancy(gymId),
    detectLikelyClosed(prisma, gymId),
  ])

  const chartData = data30d

  // Trend: Vergleiche aktuelle Auslastung mit vorletztem Wert
  let trend: 'up' | 'down' | 'equal' = 'equal';
  let previousCount = null;
  if (latestOccupancy) {
    const prev = await prisma.occupancy.findFirst({
      where: { gymId, timestamp: { lt: latestOccupancy.timestamp } },
      orderBy: { timestamp: 'desc' },
    });
    if (prev) {
      previousCount = prev.count;
      if (latestOccupancy.count > prev.count) trend = 'up';
      else if (latestOccupancy.count < prev.count) trend = 'down';
    }
  }

  const gymName = gymInfo?.name || 'Unbekanntes Studio'
  const gymMaxCapacity = GYM_CONFIG_BY_ID[gymId]?.maxCapacity ?? latestOccupancy?.maxCount ?? 160
  const isLikelyClosed = closedStatus.isLikelyClosed
  const displayCount = isLikelyClosed ? 0 : (latestOccupancy?.count ?? 0)

  const berlinWeekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date())

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const currentWeekday = weekdayMap[berlinWeekday] ?? 0

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header with Back Button */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <Link
            href="/"
            className="inline-block text-blue-100 hover:text-white mb-4 transition-colors"
          >
            ← Zurück zur Übersicht
          </Link>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-2">{gymName}</h1>
          <p className="text-blue-100">
            Detaillierte Auslastungsanalyse - Wöchentlich & Stündlich
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Live Status */}
        {latestOccupancy && (
          <div className="bg-white rounded-xl shadow-lg p-8 mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Aktuelle Auslastung</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <p className="text-gray-600 text-sm font-semibold">PERSONEN</p>
                <p className="text-4xl font-bold text-blue-600 mt-2">
                  {displayCount}
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-sm font-semibold">AUSLASTUNG</p>
                <p className="text-4xl font-bold mt-2">
                  {Math.round((displayCount / gymMaxCapacity) * 100)}%
                </p>
                {isLikelyClosed && (
                  <p className="text-xs text-amber-700 mt-1">Geschlossen (erkannt)</p>
                )}
              </div>
              <div>
                <p className="text-gray-600 text-sm font-semibold">TREND</p>
                <p className="text-lg font-bold mt-2">
                  {trend === 'up' ? '📈 zunehmend' : trend === 'down' ? '📉 abnehmend' : '➡️ gleichbleibend'}
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-sm font-semibold">AKTUALISIERT</p>
                <p className="text-lg mt-2">
                  {new Date(latestOccupancy.timestamp).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
                </p>
              </div>
            </div>
          </div>
        )}

        <GymAnalyticsClient
          currentWeekday={currentWeekday}
          maxCapacity={gymMaxCapacity}
          dataByRange={{
            '30D': data30d,
            '1Y': data1y,
            ALL: dataAll,
          }}
        />

        {/* Summary Stats */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
            <h3 className="text-lg font-semibold mb-2">Gering ausgelastet</h3>
            <p className="text-3xl font-bold">
              {chartData.filter((d) => (d.median_count / gymMaxCapacity) * 100 < 50).length}
            </p>
            <p className="text-sm opacity-90 mt-2">Slots mit &lt;50% Auslastung</p>
          </div>

          <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl shadow-lg p-6 text-white">
            <h3 className="text-lg font-semibold mb-2">Moderat ausgelastet</h3>
            <p className="text-3xl font-bold">
              {chartData.filter((d) => {
                const p = (d.median_count / gymMaxCapacity) * 100
                return p >= 50 && p < 80
              }).length}
            </p>
            <p className="text-sm opacity-90 mt-2">Slots mit 50-80% Auslastung</p>
          </div>

          <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg p-6 text-white">
            <h3 className="text-lg font-semibold mb-2">Stark ausgelastet</h3>
            <p className="text-3xl font-bold">
              {chartData.filter((d) => (d.median_count / gymMaxCapacity) * 100 >= 80).length}
            </p>
            <p className="text-sm opacity-90 mt-2">Slots mit &gt;80% Auslastung</p>
          </div>
        </div>
      </div>
    </main>
  )
}
