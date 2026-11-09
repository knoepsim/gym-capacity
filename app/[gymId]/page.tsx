import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Activity, ArrowLeft, TriangleAlert } from 'lucide-react'
import { GymAnalyticsClient } from './GymAnalyticsClient'
import gyms from '@/config/gyms.json'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DailyTrendChart } from '@/app/components/DailyTrendChart'
import { FavoriteToggle } from '@/app/components/FavoriteToggle'
import { FeedbackWidget } from '@/app/components/FeedbackWidget'
import { RecentGymTracker } from '@/app/components/RecentGymTracker'
import { getCachedGymSnapshot } from '@/app/lib/gymSnapshot'
import {
  MIN_HISTORY_DAYS_FOR_RECOMMENDATION,
  berlinHour,
  computeDeviation,
  computeTrend,
  describeDeviation,
  findBestTime,
  formatHourWindow,
} from '@/app/lib/insights'
import { LevelBadge } from '@/app/components/LevelBadge'
import { occupancyLevel } from '@/app/lib/occupancyLevel'
import { isStale } from '@/app/lib/staleness'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const GYM_CONFIG_BY_ID = Object.fromEntries(gyms.map((gym) => [gym.id, gym])) as Record<
  string,
  (typeof gyms)[number]
>

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

interface PageProps {
  params: Promise<{
    gymId: string
  }>
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
}

export default async function GymDetailPage({ params }: PageProps) {
  const { gymId } = await params

  // Avoid treating static file-like paths (e.g. /logo.png) as gym IDs.
  if (gymId.includes('.')) {
    notFound()
  }

  const gymInfo = await getGymInfo(gymId)
  if (!gymInfo) {
    notFound()
  }

  const snapshot = await getCachedGymSnapshot(prisma, gymId)
  const { aggregated30d, dailySeries: todaySeries, latest, closedStatus } = snapshot

  const unit = gymInfo.unit === 'percent' ? 'percent' : 'persons'
  const maxCapacity = GYM_CONFIG_BY_ID[gymId]?.maxCapacity ?? latest?.maxCount ?? (unit === 'percent' ? 100 : 160)
  const isLikelyClosed = closedStatus.isLikelyClosed
  const displayCount = isLikelyClosed ? 0 : (latest?.count ?? 0)
  const utilization = Math.round((displayCount / maxCapacity) * 100)
  const level = occupancyLevel(utilization)
  const location = [gymInfo.city, gymInfo.region].filter(Boolean).join(', ')
  const stale = isStale(latest?.timestamp ?? null, gymInfo.region)

  const hour = berlinHour()
  const forecastReady = (snapshot.historyDays ?? 0) >= MIN_HISTORY_DAYS_FOR_RECOMMENDATION
  const live = latest !== null && !isLikelyClosed && !stale
  const trend = live ? computeTrend(todaySeries, displayCount, maxCapacity, hour) : null
  const deviation = live && forecastReady ? computeDeviation(todaySeries, displayCount, maxCapacity, hour) : null
  const bestTime = !isLikelyClosed && forecastReady ? findBestTime(todaySeries, hour) : null
  const amount = (value: number) => (unit === 'percent' ? `${value} %` : `${value} Personen`)
  const change = (value: number) => (unit === 'percent' ? `${value} Pkt.` : `${value} Personen`)

  const currentWeekday =
    WEEKDAY_INDEX[new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Europe/Berlin' }).format(new Date())] ?? 0

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-6 pb-24 sm:px-6 lg:px-8">
      <RecentGymTracker gymId={gymId} />
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/">
            <ArrowLeft data-icon="inline-start" />
            Übersicht
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{gymInfo.name}</h1>
            {location ? <p className="text-muted-foreground">{location}</p> : null}
          </div>
          <FavoriteToggle gymId={gymId} />
        </div>
      </div>

      {stale && latest ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Daten veraltet</AlertTitle>
          <AlertDescription>Letzter Messwert von {formatTime(latest.timestamp)} Uhr. Die Quelle liefert gerade nichts Neues.</AlertDescription>
        </Alert>
      ) : null}

      {latest && (
        <Card>
          <CardHeader>
            <CardTitle>Jetzt</CardTitle>
            <CardDescription>Stand {formatTime(latest.timestamp)} Uhr</CardDescription>
            <CardAction>
              {isLikelyClosed ? (
                <Badge variant="secondary">Geschlossen</Badge>
              ) : (
                <LevelBadge level={level} />
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-6 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">{unit === 'persons' ? 'Personen' : 'Auslastung'}</dt>
                <dd className="text-2xl font-semibold sm:text-3xl tabular-nums">{unit === 'persons' ? displayCount : `${utilization}%`}</dd>
                {unit === 'persons' ? (
                  <dd className="text-xs text-muted-foreground tabular-nums">
                    {utilization} % ausgelastet
                    {!isLikelyClosed && latest.rawCount !== undefined && latest.rawCount !== displayCount
                      ? ` · geschätzt, Zähler zeigt ${latest.rawCount}`
                      : ''}
                  </dd>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Nächste 2 Stunden</dt>
                <dd className="text-2xl font-semibold sm:text-3xl">
                  {!trend ? '—' : trend.direction === 'up' ? 'Steigend' : trend.direction === 'down' ? 'Sinkend' : 'Gleich'}
                </dd>
                {trend && trend.direction !== 'equal' ? (
                  <dd className="text-xs text-muted-foreground tabular-nums">
                    {trend.change > 0 ? '+' : '−'}
                    {change(Math.abs(trend.change))}
                  </dd>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Beste Zeit heute</dt>
                <dd className="text-2xl font-semibold sm:text-3xl tabular-nums">{bestTime ? formatHourWindow(bestTime) : '—'}</dd>
                <dd className="text-xs text-muted-foreground tabular-nums">
                  {bestTime ? `ca. ${amount(bestTime.forecast)}` : !forecastReady ? 'ab einer Woche Daten' : 'heute nicht mehr'}
                </dd>
              </div>
            </dl>
            {deviation ? (
              <p className="flex items-start gap-2 text-sm">
                <Activity className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className={deviation.level !== 'usual' ? 'font-medium' : undefined}>
                  {describeDeviation(deviation, unit, snapshot.typicalWeekday ?? null)}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <FeedbackWidget gymId={gymId} gymName={gymInfo.name} />

      <Card>
        <CardHeader>
          <CardTitle>Heute</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyTrendChart data={todaySeries} height={260} showTypical={forecastReady} />
        </CardContent>
      </Card>

      <GymAnalyticsClient profile={aggregated30d} currentWeekday={currentWeekday} maxCapacity={maxCapacity} unit={unit} />
    </main>
  )
}
