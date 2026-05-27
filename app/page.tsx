export const dynamic = 'force-dynamic';
import { OverviewClient } from './components/OverviewClient'
import { ThemeToggle } from './components/ThemeToggle'
import gyms from '@/config/gyms.json'
import { Badge } from '@/components/ui/badge'
import { prisma } from '@/lib/prisma'
import { getCachedGymSnapshot } from './lib/gymSnapshot'

const GYM_CONFIG_BY_ID = Object.fromEntries(gyms.map((gym) => [gym.id, gym])) as Record<
  string,
  (typeof gyms)[number]
>

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


export default async function HomePage() {
  const gyms = await getAllGyms()

  const gymData = await Promise.all(
    gyms.map(async (gym) => {
      const snapshot = await getCachedGymSnapshot(prisma, gym.id)
      return {
        ...gym,
        latest: snapshot.latest ? { ...snapshot.latest, timestamp: new Date(snapshot.latest.timestamp) } : null,
        dailySeries: snapshot.dailySeries,
        trendDir: snapshot.trendDir,
        closedStatus: snapshot.closedStatus,
      }
    })
  )

  const closedCount = gymData.filter((gym) => gym.closedStatus?.isLikelyClosed).length
  const maxCapacityByGym = Object.fromEntries(
    gymData.map((gym) => [gym.id, GYM_CONFIG_BY_ID[gym.id]?.maxCapacity ?? gym.latest?.maxCount ?? 160])
  ) as Record<string, number>

  const serializableGyms = gymData.map((gym) => ({
    ...gym,
        latest: gym.latest
          ? {
              count: gym.latest.count,
              maxCount: gym.latest.maxCount,
              timestamp: gym.latest.timestamp.toISOString(),
            }
          : null,
  }))

  return (
    <main className="min-h-screen">
      <div className="border-b border-border/70 bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Gym Auslastung</h1>
              <p className="max-w-2xl text-muted-foreground">Auslastung in allen Gyms mit Trend</p>
            </div>
            <ThemeToggle />
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge className="rounded-md">{gymData.length} Studios</Badge>
            <Badge variant="outline" className="rounded-md">{closedCount} als geschlossen erkannt</Badge>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <OverviewClient gyms={serializableGyms} maxCapacityByGym={maxCapacityByGym} />
      </div>
    </main>
  )
}
