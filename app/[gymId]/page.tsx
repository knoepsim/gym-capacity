import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GymAnalyticsClient } from './GymAnalyticsClient'
import gyms from '@/config/gyms.json'
import { detectLikelyClosed } from '@/app/lib/closedStatus'
import { buildStableAggregatedData, buildStableTrendDirection, buildTodayForecastSeries } from '@/app/lib/forecasting'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { DailyTrendChart } from '@/app/components/DailyTrendChart'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

const prisma = new PrismaClient()

const GYM_CONFIG_BY_ID = Object.fromEntries(gyms.map((gym) => [gym.id, gym])) as Record<
  string,
  (typeof gyms)[number]
>

type RangeKey = '30D' | '1Y' | 'ALL'

interface PageProps {
  params: Promise<{
    gymId: string
  }>
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
      <main className="min-h-screen">
        <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:px-8">
          <Card className="border-border/70 bg-card/90 text-center">
            <CardHeader>
              <CardTitle className="text-3xl">Studio nicht gefunden</CardTitle>
              <CardDescription>
              Für die Gym-ID "{gymId}" gibt es kein Studio. Bitte prüfe den Link oder gehe zurück zur Übersicht.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/">Zur Startseite</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  const [data30d, data1y, dataAll, todaySeries, latestOccupancy, closedStatus] = await Promise.all([
    buildStableAggregatedData(prisma, gymId, 30),
    buildStableAggregatedData(prisma, gymId, 365),
    buildStableAggregatedData(prisma, gymId),
    buildTodayForecastSeries(prisma, gymId),
    getLatestOccupancy(gymId),
    detectLikelyClosed(prisma, gymId),
  ])

  const chartData = data30d

  const trend = latestOccupancy
    ? await buildStableTrendDirection(prisma, gymId, latestOccupancy.count, latestOccupancy.timestamp)
    : 'equal'

  const gymName = gymInfo?.name || 'Unbekanntes Studio'
  const gymMaxCapacity = GYM_CONFIG_BY_ID[gymId]?.maxCapacity ?? latestOccupancy?.maxCount ?? 160
  const isLikelyClosed = closedStatus.isLikelyClosed
  const displayCount = isLikelyClosed ? 0 : (latestOccupancy?.count ?? 0)
  const utilization = Math.round((displayCount / gymMaxCapacity) * 100)

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
    <main className="min-h-screen">
      <div className="border-b border-border/70 bg-card/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Breadcrumb className="mb-4">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/">Übersicht</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{gymName}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{gymName}</h1>
            <p className="text-muted-foreground">Detaillierte Auslastungsanalyse - wöchentlich und stündlich.</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {latestOccupancy && (
          <Card className="mb-12 border-border/70 bg-card/90">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Aktuelle Auslastung</CardTitle>
                {isLikelyClosed ? (
                  <Badge className="rounded-md bg-amber-500 text-white hover:bg-amber-500">Geschlossen erkannt</Badge>
                ) : (
                  <Badge variant="secondary" className="rounded-md">Offen</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">PERSONEN</p>
                  <p className="mt-2 text-4xl font-bold">{displayCount}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">AUSLASTUNG</p>
                  <p className="mt-2 text-4xl font-bold">{utilization}%</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">TREND</p>
                  <p className="mt-2 text-lg font-bold">
                    {trend === 'up' ? 'Zunehmend' : trend === 'down' ? 'Abnehmend' : 'Gleichbleibend'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">AKTUALISIERT</p>
                  <p className="mt-2 text-lg">
                    {new Date(latestOccupancy.timestamp).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
                  </p>
                </div>
              </div>
              <Progress value={utilization} />
            </CardContent>
          </Card>
        )}

        <Card className="mb-12 border-border/70 bg-card/90">
          <CardHeader>
            <CardTitle>Heutiger Verlauf</CardTitle>
            <CardDescription>Aktuelle Statistik für heute mit gestrichelter Prognose für kommende Stunden.</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyTrendChart data={todaySeries} height={260} />
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-[2px] w-5 bg-primary" />
                Heute
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-[2px] w-5 border-t-2 border-dashed border-amber-500" />
                Prognose
              </span>
            </div>
          </CardContent>
        </Card>

        <GymAnalyticsClient
          currentWeekday={currentWeekday}
          maxCapacity={gymMaxCapacity}
          dataByRange={{
            '30D': data30d,
            '1Y': data1y,
            ALL: dataAll,
          }}
        />

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card className="border-emerald-300/70 bg-emerald-50">
            <CardHeader>
              <CardTitle className="text-lg">Gering ausgelastet</CardTitle>
              <CardDescription>Slots mit &lt;50% Auslastung</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-emerald-900">
              {chartData.filter((d) => (d.median_count / gymMaxCapacity) * 100 < 50).length}
              </p>
            </CardContent>
          </Card>

          <Card className="border-amber-300/70 bg-amber-50">
            <CardHeader>
              <CardTitle className="text-lg">Moderat ausgelastet</CardTitle>
              <CardDescription>Slots mit 50-80% Auslastung</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-amber-900">
              {chartData.filter((d) => {
                const p = (d.median_count / gymMaxCapacity) * 100
                return p >= 50 && p < 80
              }).length}
              </p>
            </CardContent>
          </Card>

          <Card className="border-red-300/70 bg-red-50">
            <CardHeader>
              <CardTitle className="text-lg">Stark ausgelastet</CardTitle>
              <CardDescription>Slots mit &gt;80% Auslastung</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-red-900">
              {chartData.filter((d) => (d.median_count / gymMaxCapacity) * 100 >= 80).length}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
