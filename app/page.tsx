export const dynamic = 'force-dynamic';
import { PrismaClient } from '@prisma/client'
import { GymCard } from './components/GymCard'
import gyms from '@/config/gyms.json'
import { detectLikelyClosed } from './lib/closedStatus'
import { Badge } from '@/components/ui/badge'

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
      avg_count: toPlainNumber(item.avg_count),
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
