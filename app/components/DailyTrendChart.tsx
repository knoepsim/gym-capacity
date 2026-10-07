"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface DailyTrendPoint {
  hour: number;
  actual_count: number | null;
  forecast_count: number | null;
}

interface DailyTrendChartProps {
  data: DailyTrendPoint[];
  height?: number;
}

const dailyTrendConfig = {
  actual_count: {
    label: "Heute",
    color: "hsl(var(--primary))",
  },
  forecast_count: {
    label: "Prognose",
    color: "#f59e0b",
  },
} satisfies ChartConfig;

function formatHourRange(value: unknown): string {
  const hour = Number(value)
  const safeHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0
  return `${String(safeHour).padStart(2, "0")}:00-${String(safeHour).padStart(2, "0")}:59 Uhr`
}

export function DailyTrendChart({ data, height = 240 }: DailyTrendChartProps) {
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
    <ChartContainer config={dailyTrendConfig} className="w-full" style={{ height }}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="hour"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => `${String(value).padStart(2, "0")}:00`}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatHourRange(value)}
              formatter={(value) => `${Math.round(Number(value))}`}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="actual_count"
          connectNulls
          stroke="var(--color-actual_count)"
          fill="var(--color-actual_count)"
          fillOpacity={0.22}
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
      </AreaChart>
    </ChartContainer>
  );
}

