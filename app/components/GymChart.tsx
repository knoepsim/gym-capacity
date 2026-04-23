"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface ChartDataPoint {
  weekday: number;
  hour: number;
  median_count: number;
  max_capacity: number;
}

const WEEKDAY_NAMES = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

interface GymChartProps {
  data: ChartDataPoint[];
  weekdayOrder?: number[];
  maxCapacity: number;
}

const chartConfig = {
  median_count: {
    label: "Median",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

export function GymChart({ data, weekdayOrder, maxCapacity }: GymChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-lg text-muted-foreground">
          Noch keine Daten vorhanden. Der Fetcher wird diese in Kürze abrufen.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Gruppiere Daten nach Wochentag
  const weekdayData: Record<number, ChartDataPoint[]> = {};
  data.forEach((item) => {
    if (!weekdayData[item.weekday]) {
      weekdayData[item.weekday] = [];
    }
    weekdayData[item.weekday].push(item);
  });

  // Sortiere Stunden für die X-Achse
  Object.entries(weekdayData).forEach(([, dayArray]) => {
    dayArray.sort((a, b) => a.hour - b.hour);
  });

  const orderedWeekdays = weekdayOrder ?? [0, 1, 2, 3, 4, 5, 6];

  return (
    <div className="space-y-8">
      {orderedWeekdays.map((weekdayIndex) => {
        const dayData = weekdayData[weekdayIndex] ?? [];
        const weekday = String(weekdayIndex);
        const weekdayName = WEEKDAY_NAMES[weekdayIndex];
        return (
          <Card key={weekday} className="border-border/70 bg-card/90">
            <CardHeader className="pb-2">
              <CardTitle>{weekdayName}</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[300px] w-full">
                <AreaChart
                  data={dayData}
                  margin={{ top: 20, right: 30, left: 0, bottom: 60 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="hour"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(tick) => `${String(tick).padStart(2, "0")}:00`}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    label={{ value: "Personen", angle: -90, position: "insideLeft" }}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        // labelFormatter={(label) => `${String(label).padStart(2, "0")}:00 Uhr`}
                        formatter={(value) => `${Math.round(Number(value))}`}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="median_count"
                    stroke="var(--color-median_count)"
                    fill="var(--color-median_count)"
                    fillOpacity={0.25}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary" className="rounded-md">0-50% Auslastung</Badge>
              <Badge className="rounded-md bg-amber-500 text-white hover:bg-amber-500">50-80% Auslastung</Badge>
              <Badge variant="destructive" className="rounded-md">&gt;80% Auslastung</Badge>
            </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}