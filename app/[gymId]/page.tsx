import { PrismaClient } from '@prisma/client'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GymAnalyticsClient } from './GymAnalyticsClient'
import gyms from '@/config/gyms.json'
import { detectLikelyClosed } from '@/app/lib/closedStatus'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { DailyTrendChart, type DailyTrendPoint } from '@/app/components/DailyTrendChart'
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

interface AggregatedData {
  weekday: bigint
  hour: bigint
  median_count: number
  max_capacity: number
}

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
      median_count: toPlainNumber(item.median_count),
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
            AND (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin') >
                ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin') - INTERVAL '28 days')
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

    const lastActualValue =
      [...actualByHour.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, value]) => value)
        .filter((value) => Number.isFinite(value))
        .at(-1) ?? null

    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      actual_count: actualByHour.get(hour) ?? null,
      forecast_count:
        hour > currentHourBerlin
          ? (forecastByHour.get(hour) ?? lastActualValue)
          : null,
    }))
  } catch (error) {
    console.error('Fehler beim Abrufen der Tagesdaten:', error)
    return Array.from({ length: 24 }, (_, hour) => ({ hour, actual_count: null, forecast_count: null }))
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
    getAggregatedData(gymId, '30D'),
    getAggregatedData(gymId, '1Y'),
    getAggregatedData(gymId, 'ALL'),
    getGymTodaySeries(gymId),
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
