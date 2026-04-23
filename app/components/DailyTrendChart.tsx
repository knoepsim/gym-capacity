"use client";

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
  return (
    <ChartContainer config={dailyTrendConfig} className="w-full" style={{ height }}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          connectNulls
          stroke="var(--color-forecast_count)"
          fill="none"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      </AreaChart>
    </ChartContainer>
  );
}
