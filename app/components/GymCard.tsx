'use client'

import Link from 'next/link'
import { MoveRight, TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { DailyTrendChart, type DailyTrendPoint } from '@/app/components/DailyTrendChart'
import { cn } from '@/lib/utils'

interface GymCardProps {
  id: string
  name: string
  currentCount: number
  maxCount: number
  lastUpdate: Date
  dailySeries: DailyTrendPoint[]
  isLikelyClosed: boolean
  closedStableMinutes: number
}

export function GymCard({
  id,
  name,
  currentCount,
  maxCount,
  lastUpdate,
  dailySeries,
  isLikelyClosed,
  closedStableMinutes,
}: GymCardProps) {
  const displayCount = isLikelyClosed ? 0 : currentCount
  const percentage = maxCount > 0 ? Math.round((displayCount / maxCount) * 100) : 0
  const available = Math.max(0, maxCount - displayCount)

  // Berechne Minuten seit letztem Update
  const now = new Date()
  const minutesAgo = Math.floor((now.getTime() - new Date(lastUpdate).getTime()) / 60000)

  // Trenddaten aus Prognose der nächsten 2 Stunden
  const currentHour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'Europe/Berlin',
    }).format(now)
  )
  const nextTwoHours = dailySeries.filter(
    (d) => (d.hour === currentHour || d.hour === currentHour + 1) && d.forecast_count !== null
  )
  const hasTrendData = nextTwoHours.length > 0
  const avgTrendCount = hasTrendData
    ? Math.round(nextTwoHours.reduce((sum, d) => sum + (d.forecast_count ?? 0), 0) / nextTwoHours.length)
    : displayCount
  const trendDirection = avgTrendCount > displayCount ? 'up' : avgTrendCount < displayCount ? 'down' : 'equal'
  const trendChange = Math.abs(avgTrendCount - displayCount)

  const getStatusClass = (percent: number) => {
    if (percent >= 80) return 'bg-destructive text-destructive-foreground'
    if (percent >= 50) return 'bg-amber-500 text-white'
    return 'bg-emerald-600 text-white'
  }

  const getStatusText = (percent: number) => {
    if (percent >= 80) return 'Sehr voll'
    if (percent >= 50) return 'Moderat'
    return 'Leer'
  }

  return (
    <Link href={`/${id}`}>
      <Card className="h-full cursor-pointer overflow-hidden border-border/70 bg-card/90 backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-lg">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-xl">{name}</CardTitle>
            <Badge className={cn('rounded-md px-2 py-1 text-[11px] uppercase', getStatusClass(percentage))}>
              {isLikelyClosed ? 'Geschlossen' : getStatusText(percentage)}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <span className="text-4xl font-bold leading-none">{displayCount}</span>
            <span className="pb-1 text-sm text-muted-foreground">/ {maxCount} Personen</span>
          </div>

          <div className="space-y-2">
            <Progress value={percentage} className="h-2.5" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{percentage}% ausgelastet</span>
              <span>{available} verfugbar</span>
            </div>
            {isLikelyClosed && (
              <p className="text-xs text-amber-700">
                Count seit ca. {closedStableMinutes} Min unverandert. Anzeige auf 0 gesetzt.
              </p>
            )}
          </div>

          {!isLikelyClosed ? (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Heute & Prognose</p>
              {hasTrendData ? (
                <div className="mb-2 flex items-center gap-1 text-sm font-semibold">
                  {trendDirection === 'up' ? <TrendingUp className="h-4 w-4" /> : null}
                  {trendDirection === 'down' ? <TrendingDown className="h-4 w-4" /> : null}
                  {trendDirection === 'equal' ? <MoveRight className="h-4 w-4" /> : null}
                  {trendChange > 0 ? '+' : ''}{trendChange} Personen (nächste 2h)
                </div>
              ) : (
                <p className="mb-2 text-xs text-muted-foreground">Noch keine Prognose für die nächsten Stunden verfügbar.</p>
              )}
              <DailyTrendChart data={dailySeries} height={140} />
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-[2px] w-4 bg-primary" />
                  Heute
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-[2px] w-4 border-t-2 border-dashed border-amber-500" />
                  Prognose
                </span>
              </div>
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>Aktualisiert vor {minutesAgo} Min</span>
          <span className="font-medium text-foreground">Details ansehen</span>
        </CardFooter>
      </Card>
    </Link>
  )
}
