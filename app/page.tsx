export const dynamic = 'force-dynamic';
import { PrismaClient } from '@prisma/client'
import { GymCard } from './components/GymCard'
import gyms from '@/config/gyms.json'
import { detectLikelyClosed } from './lib/closedStatus'

const prisma = new PrismaClient()

const GYM_CONFIG_BY_ID = Object.fromEntries(gyms.map((gym) => [gym.id, gym])) as Record<
  string,
  (typeof gyms)[number]
>

interface AggregatedData {
  weekday: bigint
  hour: bigint
  avg_count: number
  max_capacity: number
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

async function getGymTrend(gymId: string) {
  try {
    const trendData = await prisma.$queryRaw<AggregatedData[]>`
      SELECT 
        EXTRACT(HOUR FROM timestamp) as hour,
        ROUND(AVG(count)::numeric, 2) as avg_count,
        MAX("maxCount") as max_capacity
      FROM "Occupancy"
      WHERE "gymId" = ${gymId}
        AND timestamp > NOW() - INTERVAL '7 days'
      GROUP BY EXTRACT(HOUR FROM timestamp)
      ORDER BY hour;
    `

    return trendData.map((item: AggregatedData) => ({
      hour: Number(item.hour),
      avg_count: typeof item.avg_count === 'string' ? parseFloat(item.avg_count) : item.avg_count,
    }))
  } catch (error) {
    console.error('Fehler beim Abrufen des Trends:', error)
    return []
  }
}


export default async function HomePage() {
  const gyms = await getAllGyms()
  // Debug: Logge die Gyms
  console.log('GYMS FROM PRISMA:', gyms)

  // Hole aktuelle Auslastung und Trend für alle Gyms
  const gymData = await Promise.all(
    gyms.map(async (gym) => {
      const [latest, trend, closedStatus] = await Promise.all([
        getLatestOccupancy(gym.id),
        getGymTrend(gym.id),
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
        trend,
        trendDir,
        closedStatus,
      }
    })
  )
  // Debug: Logge gymData
  console.log('GYM DATA FOR RENDER:', gymData)
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-3">
            💪 Gym Auslastung
          </h1>
          <p className="text-blue-100 text-lg">
            Live-Auslastung in allen Gyms
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Gyms Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {gymData.map((gym) => (
            <div key={gym.id} className="flex flex-col">
              <GymCard
                id={gym.id}
                name={gym.name}
                currentCount={gym.latest?.count ?? 0}
                maxCount={GYM_CONFIG_BY_ID[gym.id]?.maxCapacity ?? gym.latest?.maxCount ?? 160}
                lastUpdate={gym.latest?.timestamp ?? new Date()}
                trendData={gym.trend ?? []}
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
