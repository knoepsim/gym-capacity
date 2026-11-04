"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface DailyTrendPoint {
  hour: number;
  actual_count: number | null;
  forecast_count: number | null;
  /** Usual value for this weekday and hour; missing in snapshots computed before it existed. */
  typical_count?: number | null;
}

interface DailyTrendChartProps {
  data: DailyTrendPoint[];
  height?: number;
  showLegend?: boolean;
  /** Draws the usual curve of this weekday behind today's values. */
  showTypical?: boolean;
}

const dailyTrendConfig = {
  typical_count: {
    label: "Üblich",
    color: "var(--muted-foreground)",
  },
  actual_count: {
    label: "Heute",
    color: "var(--chart-1)",
  },
  forecast_count: {
    label: "Prognose",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

function formatHourRange(value: unknown): string {
  const hour = Number(value)
  const safeHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0
  return `${String(safeHour).padStart(2, "0")}:00-${String(safeHour).padStart(2, "0")}:59 Uhr`
}

export function DailyTrendChart({ data, height = 240, showLegend = true, showTypical = false }: DailyTrendChartProps) {
  const currentBerlinHour = useMemo(() => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Berlin',
        hour: 'numeric',
        hourCycle: 'h23',
      })
      return Number(formatter.format(new Date()))
    } catch {
      return new Date().getHours()
    }
  }, [])

  // Strictly filter:
  // - actual_count is only past & current (hour <= currentBerlinHour)
  // - forecast_count is strictly current & future (hour >= currentBerlinHour)
  const chartData = useMemo(() => {
    return data.map((d) => ({
      ...d,
      actual_count: d.hour > currentBerlinHour ? null : d.actual_count,
      forecast_count: d.hour < currentBerlinHour ? null : d.forecast_count,
    }))
  }, [data, currentBerlinHour])

  return (
    <ChartContainer config={dailyTrendConfig} className="aspect-auto w-full" style={{ height }}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-actual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-actual_count)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-actual_count)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="hour"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(value) => `${String(value).padStart(2, "0")}:00`}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatHourRange(value)}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {dailyTrendConfig[name as keyof typeof dailyTrendConfig]?.label ?? name}
                  </span>
                  <span className="font-mono font-medium tabular-nums">{Math.round(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        {showTypical ? (
          <Area
            type="monotone"
            dataKey="typical_count"
            stroke="var(--color-typical_count)"
            strokeOpacity={0.6}
            fill="var(--color-typical_count)"
            fillOpacity={0.06}
            strokeWidth={1.5}
            activeDot={false}
          />
        ) : null}
        <Area
          type="monotone"
          dataKey="actual_count"
          connectNulls
          stroke="var(--color-actual_count)"
          fill="url(#fill-actual)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="forecast_count"
          stroke="var(--color-forecast_count)"
          fill="none"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
        {showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null}
      </AreaChart>
    </ChartContainer>
  );
}
