export const dynamic = 'force-dynamic';
import { OverviewClient, type OverviewGym } from './components/OverviewClient'
import gyms from '@/config/gyms.json'
import { Badge } from '@/components/ui/badge'
import { prisma } from '@/lib/prisma'
import type { GymSnapshot } from './lib/gymSnapshot'
import { BASE_INTERVAL_MINUTES, intervalMinutesFor } from './lib/polling'

const GYM_CONFIG_BY_ID = Object.fromEntries(gyms.map((gym) => [gym.id, gym])) as Record<
  string,
  (typeof gyms)[number]
>

type OverviewRow = {
  id: string
  name: string
  provider: string
  unit: string
  region: string | null
  city: string | null
  latest: GymSnapshot['latest'] | null
  dailySeries: GymSnapshot['dailySeries'] | null
  trendDir: GymSnapshot['trendDir'] | null
  closedStatus: GymSnapshot['closedStatus'] | null
  historyDays: number | null
}

// Only the parts of the cached snapshot the cards need; the weekly profiles stay in the database.
async function getOverviewGyms(): Promise<OverviewRow[]> {
  try {
    return await prisma.$queryRaw<OverviewRow[]>`
      SELECT
        g."id", g."name", g."provider", g."unit", g."region", g."city",
        c."payload"->'latest' AS "latest",
        c."payload"->'dailySeries' AS "dailySeries",
        c."payload"->'trendDir' AS "trendDir",
        c."payload"->'closedStatus' AS "closedStatus",
        (c."payload"->>'historyDays')::int AS "historyDays"
      FROM "Gym" g
      LEFT JOIN "GymAnalyticsCache" c ON c."gymId" = g."id"
      WHERE g."active" = true
      ORDER BY g."name"
    `
  } catch (error) {
    console.error('Fehler beim Abrufen der Gyms:', error)
    return []
  }
}

export default async function HomePage() {
  const rows = await getOverviewGyms()

  const overviewGyms: OverviewGym[] = rows.map((gym) => ({
    id: gym.id,
    name: gym.name,
    provider: gym.provider,
    unit: gym.unit === 'percent' ? 'percent' : 'persons',
    region: gym.region,
    city: gym.city,
    latest: gym.latest ?? null,
    dailySeries: gym.dailySeries ?? [],
    trendDir: gym.trendDir ?? 'equal',
    closedStatus: gym.closedStatus ?? { isLikelyClosed: false, stableMinutes: 0 },
    historyDays: gym.historyDays ?? 0,
    maxCount:
      GYM_CONFIG_BY_ID[gym.id]?.maxCapacity ?? gym.latest?.maxCount ?? (gym.unit === 'percent' ? 100 : 160),
  }))

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pt-8 pb-24 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Wie voll ist dein Studio?</h1>
        <p className="max-w-2xl text-muted-foreground">
          Live-Auslastung mit Prognose und bester Trainingszeit für den heutigen Tag.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{overviewGyms.length} Studios</Badge>
          <Badge variant="outline">
            Aktualisiert alle {BASE_INTERVAL_MINUTES}–{intervalMinutesFor(null)} Minuten
          </Badge>
        </div>
      </header>
      <OverviewClient gyms={overviewGyms} />
    </main>
  )
}
