"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface ChartDataPoint {
  hour: number;
  median_count: number;
}

interface GymChartProps {
  /** Typical value per hour of one weekday. */
  data: ChartDataPoint[];
  unit?: 'persons' | 'percent';
}

const chartConfig = {
  median_count: {
    label: "Typisch",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function formatHourRange(value: unknown): string {
  const hour = Number(value);
  const safeHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0;
  return `${String(safeHour).padStart(2, "0")}:00-${String(safeHour).padStart(2, "0")}:59 Uhr`;
}

export function GymChart({ data, unit = 'persons' }: GymChartProps) {
  const unitLabel = unit === "percent" ? "%" : "Personen";

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-median" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-median_count)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-median_count)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="hour"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(tick) => `${String(tick).padStart(2, "0")}:00`}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatHourRange(label)}
              formatter={(value) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">Typisch</span>
                  <span className="font-mono font-medium tabular-nums">
                    {Math.round(Number(value))} {unitLabel}
                  </span>
                </div>
              )}
            />
          }
        />
        <Area type="monotone" dataKey="median_count" stroke="var(--color-median_count)" fill="url(#fill-median)" strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
