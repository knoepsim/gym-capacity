'use client'

import Link from 'next/link'
import { BarChart, Bar } from 'recharts'
import { MoveRight, TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { cn } from '@/lib/utils'

interface GymCardProps {
  id: string
  name: string
  currentCount: number
  maxCount: number
  lastUpdate: Date
  trendData: { hour: number; avg_count: number }[]
  isLikelyClosed: boolean
  closedStableMinutes: number
}

const trendChartConfig = {
  avg_count: {
    label: 'Prognose',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig

export function GymCard({
  id,
  name,
  currentCount,
  maxCount,
  lastUpdate,
  trendData,
  isLikelyClosed,
  closedStableMinutes,
}: GymCardProps) {
  const displayCount = isLikelyClosed ? 0 : currentCount
  const percentage = maxCount > 0 ? Math.round((displayCount / maxCount) * 100) : 0
  const available = Math.max(0, maxCount - displayCount)

  // Berechne Minuten seit letztem Update
  const now = new Date()
  const minutesAgo = Math.floor((now.getTime() - new Date(lastUpdate).getTime()) / 60000)

  // Trenddaten
  const currentHour = now.getHours()
  const nextTwoHours = trendData.filter(d => d.hour === currentHour || d.hour === currentHour + 1)
  const hasTrendData = nextTwoHours.length > 0
  const avgTrendCount = hasTrendData
    ? Math.round(nextTwoHours.reduce((sum, d) => sum + d.avg_count, 0) / nextTwoHours.length)
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

          {!isLikelyClosed && hasTrendData ? (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Trend nachste 2h</p>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="mb-1 flex items-center gap-1 text-sm font-semibold">
                    {trendDirection === 'up' ? <TrendingUp className="h-4 w-4" /> : null}
                    {trendDirection === 'down' ? <TrendingDown className="h-4 w-4" /> : null}
                    {trendDirection === 'equal' ? <MoveRight className="h-4 w-4" /> : null}
                    {trendChange > 0 ? '+' : ''}{trendChange} Personen
                  </p>
                </div>
                <ChartContainer config={trendChartConfig} className="h-[42px] w-[120px]">
                  <BarChart data={nextTwoHours} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent hideLabel formatter={(value) => `${Math.round(Number(value))}`} />}
                    />
                    <Bar dataKey="avg_count" fill="var(--color-avg_count)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
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
