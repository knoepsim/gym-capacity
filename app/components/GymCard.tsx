'use client'

import Link from 'next/link'
import { Activity, Clock, MoveRight, Star, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { DailyTrendChart, type DailyTrendPoint } from '@/app/components/DailyTrendChart'
import { OCCUPANCY_LEVEL_BADGE, OCCUPANCY_LEVEL_LABEL, occupancyLevel } from '@/app/lib/occupancyLevel'
import {
  MIN_HISTORY_DAYS_FOR_RECOMMENDATION,
  berlinHour,
  computeDeviation,
  computeTrend,
  describeDeviationShort,
  findBestTime,
  formatHourWindow,
} from '@/app/lib/insights'
import { isStale } from '@/app/lib/staleness'
import { cn } from '@/lib/utils'

interface GymCardProps {
  id: string
  name: string
  location?: string
  region?: string | null
  unit?: 'persons' | 'percent'
  hasData?: boolean
  currentCount: number
  maxCount: number
  lastUpdate: Date | string | null
  dailySeries: DailyTrendPoint[]
  isLikelyClosed: boolean
  historyDays?: number
  isFavorite?: boolean
  onToggleFavorite?: (gymId: string) => void
}

export function GymCard({
  id,
  name,
  location,
  region = null,
  unit = 'persons',
  hasData = true,
  currentCount,
  maxCount,
  lastUpdate,
  dailySeries,
  isLikelyClosed,
  historyDays = 0,
  isFavorite = false,
  onToggleFavorite,
}: GymCardProps) {
  const displayCount = isLikelyClosed ? 0 : currentCount
  const percentage = maxCount > 0 ? Math.round((displayCount / maxCount) * 100) : 0
  const level = occupancyLevel(percentage)

  // Trend, comparison and recommendation from the shared helpers (same as the detail page)
  const hour = berlinHour()
  const stale = hasData && isStale(lastUpdate, region)
  const forecastReady = historyDays >= MIN_HISTORY_DAYS_FOR_RECOMMENDATION
  const live = hasData && !isLikelyClosed && !stale
  const trend = live ? computeTrend(dailySeries, displayCount, maxCount, hour) : null
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : MoveRight
  const deviation = live && forecastReady ? computeDeviation(dailySeries, displayCount, maxCount, hour) : null
  const bestTime = !isLikelyClosed && forecastReady ? findBestTime(dailySeries, hour) : null
  const changeUnit = unit === 'percent' ? 'Pkt.' : 'Personen'

  const statusBadge = !hasData ? (
    <Badge variant="outline">Keine Daten</Badge>
  ) : stale ? (
    <Badge variant="outline">
      <TriangleAlert data-icon="inline-start" />
      Veraltet
    </Badge>
  ) : isLikelyClosed ? (
    <Badge variant="secondary">Geschlossen</Badge>
  ) : (
    <Badge variant={OCCUPANCY_LEVEL_BADGE[level]}>{OCCUPANCY_LEVEL_LABEL[level]}</Badge>
  )

  return (
    <Card className="relative h-full transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="text-lg">
          {/* Stretched link: the whole card opens the detail page */}
          <Link href={`/${id}`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
            {name}
          </Link>
        </CardTitle>
        {location ? <CardDescription>{location}</CardDescription> : null}
        <CardAction className="relative flex items-center gap-1">
          {statusBadge}
          {onToggleFavorite ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
              aria-pressed={isFavorite}
              onClick={() => onToggleFavorite(id)}
            >
              <Star className={cn(isFavorite && 'fill-warning text-warning')} />
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {!hasData ? (
          <p className="text-sm text-muted-foreground">Noch keine Messwerte.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums">{unit === 'percent' ? `${percentage}%` : displayCount}</span>
              <span className="text-sm text-muted-foreground">{unit === 'percent' ? 'ausgelastet' : `Personen · ${percentage} %`}</span>
            </p>
            <Progress value={Math.min(percentage, 100)} aria-label="Auslastung" />
          </div>
        )}

        {deviation || trend || bestTime ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {deviation ? (
              <li className={cn('flex items-center gap-1.5', deviation.level !== 'usual' && 'font-medium')}>
                <Activity className="size-4 shrink-0 text-muted-foreground" />
                {describeDeviationShort(deviation)}
              </li>
            ) : null}
            {trend ? (
              <li className="flex items-center gap-1.5">
                <TrendIcon className="size-4 shrink-0 text-muted-foreground" />
                {trend.direction === 'equal'
                  ? 'Bleibt in den nächsten 2 h etwa gleich'
                  : `${trend.change > 0 ? '+' : '−'}${Math.abs(trend.change)} ${changeUnit} in den nächsten 2 h`}
              </li>
            ) : null}
            {bestTime ? (
              <li className="flex items-center gap-1.5">
                <Clock className="size-4 shrink-0 text-muted-foreground" />
                Beste Zeit heute: <span className="font-medium">{formatHourWindow(bestTime)}</span>
              </li>
            ) : null}
          </ul>
        ) : null}

        {hasData ? (
          // Today's curve is shown even when the gym is closed. Above the stretched link so the tooltip stays usable
          <div className="relative mt-auto">
            <DailyTrendChart data={dailySeries} height={120} showLegend={false} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
