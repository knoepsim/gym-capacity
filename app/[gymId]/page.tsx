import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { GymChart } from '@/app/GymChart'

const prisma = new PrismaClient()

interface AggregatedData {
  weekday: bigint
  hour: bigint
  avg_count: number
  max_capacity: number
}

interface PageProps {
  params: Promise<{
    gymId: string
  }>
}

async function getAggregatedData(gymId: string) {
  try {
    const rawData = await prisma.$queryRaw<AggregatedData[]>`
      SELECT 
        EXTRACT(DOW FROM timestamp) as weekday,
        EXTRACT(HOUR FROM timestamp) as hour,
        ROUND(AVG(count)::numeric, 2) as avg_count,
        MAX("maxCount") as max_capacity
      FROM "Occupancy"
      WHERE "gymId" = ${gymId}
        AND timestamp > NOW() - INTERVAL '30 days'
      GROUP BY EXTRACT(DOW FROM timestamp), EXTRACT(HOUR FROM timestamp)
      ORDER BY weekday, hour;
    `

    return rawData.map((item: AggregatedData) => ({
      weekday: Number(item.weekday),
      hour: Number(item.hour),
      avg_count: typeof item.avg_count === 'string' ? parseFloat(item.avg_count) : item.avg_count,
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

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const WEEKDAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

function getOccupancyColor(count: number, max: number): string {
  const percent = (count / max) * 100
  if (percent >= 80) return 'bg-red-100 text-red-900'
  if (percent >= 50) return 'bg-amber-100 text-amber-900'
  return 'bg-green-100 text-green-900'
}

export default async function GymDetailPage({ params }: PageProps) {
  const { gymId } = await params

  const [chartData, latestOccupancy, gymInfo] = await Promise.all([
    getAggregatedData(gymId),
    getLatestOccupancy(gymId),
    getGymInfo(gymId),
  ])

  const gymName = gymInfo?.name || 'Unbekanntes Studio'

  // Gruppiere Daten nach Wochentag
  const dataByWeekday: Record<number, Array<{ hour: number; avg_count: number }>> = {}
  WEEKDAYS.forEach((_, i) => {
    dataByWeekday[i] = []
  })

  chartData.forEach((item) => {
    if (!dataByWeekday[item.weekday]) {
      dataByWeekday[item.weekday] = []
    }
    dataByWeekday[item.weekday].push({
      hour: item.hour,
      avg_count: item.avg_count,
    })
  })

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
                  {latestOccupancy.count}
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-sm font-semibold">KAPAZITÄT</p>
                <p className="text-4xl font-bold text-purple-600 mt-2">
                  {latestOccupancy.maxCount}
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-sm font-semibold">AUSLASTUNG</p>
                <p
                  className={`text-4xl font-bold mt-2 ${
                    (latestOccupancy.count / latestOccupancy.maxCount) * 100 > 80
                      ? 'text-red-600'
                      : (latestOccupancy.count / latestOccupancy.maxCount) * 100 > 50
                        ? 'text-amber-600'
                        : 'text-green-600'
                  }`}
                >
                  {Math.round(
                    (latestOccupancy.count / latestOccupancy.maxCount) * 100
                  )}
                  %
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-sm font-semibold">VERFÜGBAR</p>
                <p className="text-4xl font-bold text-cyan-600 mt-2">
                  {latestOccupancy.maxCount - latestOccupancy.count}
                </p>
              </div>
            </div>
            <p className="text-gray-500 text-xs mt-4">
              Zuletzt aktualisiert: {new Date(latestOccupancy.timestamp).toLocaleString('de-DE')}
            </p>
          </div>
        )}

        {/* Chart */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Auslastungsmuster (letzte 30 Tage)
          </h2>
          <GymChart data={chartData} gymName={gymName} />
        </div>

        {/* Hourly Breakdown by Weekday */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">
            Stündliche Auslastung nach Wochentag
          </h2>

          <div className="space-y-8">
            {WEEKDAYS.map((dayShort, dayIndex) => (
              <div key={dayIndex} className="border-b border-gray-200 pb-8 last:border-0">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  {WEEKDAY_NAMES[dayIndex]} ({dayShort})
                </h3>

                {dataByWeekday[dayIndex].length === 0 ? (
                  <p className="text-gray-500">Keine Daten verfügbar</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                    {Array.from({ length: 24 }).map((_, hour) => {
                      const data = dataByWeekday[dayIndex].find((d) => d.hour === hour)
                      if (!data) return null

                      const percent =
                        latestOccupancy && latestOccupancy.maxCount > 0
                          ? (data.avg_count / latestOccupancy.maxCount) * 100
                          : 0

                      return (
                        <div
                          key={hour}
                          className={`p-3 rounded-lg text-center transition-colors ${getOccupancyColor(
                            data.avg_count,
                            latestOccupancy?.maxCount ?? 100
                          )}`}
                        >
                          <p className="text-sm font-semibold">{hour}:00</p>
                          <p className="text-lg font-bold">{Math.round(data.avg_count)}</p>
                          <p className="text-xs opacity-75">{percent.toFixed(0)}%</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
            <h3 className="text-lg font-semibold mb-2">Gering ausgelastet</h3>
            <p className="text-3xl font-bold">
              {chartData.filter((d) => (d.avg_count / (d.max_capacity ?? 100)) * 100 < 50).length}
            </p>
            <p className="text-sm opacity-90 mt-2">Slots mit &lt;50% Auslastung</p>
          </div>

          <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl shadow-lg p-6 text-white">
            <h3 className="text-lg font-semibold mb-2">Moderat ausgelastet</h3>
            <p className="text-3xl font-bold">
              {chartData.filter((d) => {
                const p = (d.avg_count / (d.max_capacity ?? 100)) * 100
                return p >= 50 && p < 80
              }).length}
            </p>
            <p className="text-sm opacity-90 mt-2">Slots mit 50-80% Auslastung</p>
          </div>

          <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg p-6 text-white">
            <h3 className="text-lg font-semibold mb-2">Stark ausgelastet</h3>
            <p className="text-3xl font-bold">
              {chartData.filter((d) => (d.avg_count / (d.max_capacity ?? 100)) * 100 >= 80).length}
            </p>
            <p className="text-sm opacity-90 mt-2">Slots mit &gt;80% Auslastung</p>
          </div>
        </div>
      </div>
    </main>
  )
}
