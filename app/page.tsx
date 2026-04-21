export const dynamic = 'force-dynamic';
import { PrismaClient } from '@prisma/client'
import { GymCard } from './components/GymCard'

const prisma = new PrismaClient()

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
      const [latest, trend] = await Promise.all([
        getLatestOccupancy(gym.id),
        getGymTrend(gym.id),
      ])
      return {
        ...gym,
        latest,
        trend,
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
            💪 Fitness Studio Kapazität
          </h1>
          <p className="text-blue-100 text-lg">
            Überwachung der Live-Auslastung in allen Studios
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {gymData.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg">Keine Studios verfügbar</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {gymData.map((gym) => (
              <GymCard
                key={gym.id}
                id={gym.id}
                name={gym.name}
                currentCount={gym.latest?.count ?? 0}
                maxCount={gym.latest?.maxCount ?? 100}
                lastUpdate={gym.latest?.timestamp ?? new Date()}
                trendData={gym.trend}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
