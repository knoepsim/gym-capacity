"use client";

import { useMemo, useState } from "react";
import { GymChart } from "@/app/components/GymChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type RangeKey = "30D" | "1Y" | "ALL";

interface ChartDataPoint {
  weekday: number;
  hour: number;
  median_count: number;
  max_capacity: number;
}

interface GymAnalyticsClientProps {
  dataByRange: Record<RangeKey, ChartDataPoint[]>;
  currentWeekday: number;
  maxCapacity: number;
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function GymAnalyticsClient({ dataByRange, currentWeekday, maxCapacity }: GymAnalyticsClientProps) {
  const [selectedRange, setSelectedRange] = useState<RangeKey>("30D");

  const chartData = dataByRange[selectedRange] ?? [];

  const weekdayOrder = useMemo(
    () => Array.from({ length: 7 }, (_, offset) => (currentWeekday + offset) % 7),
    [currentWeekday]
  );

  const dataByWeekday = useMemo(() => {
    const grouped: Record<number, Array<{ hour: number; median_count: number; max_capacity: number }>> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };

    chartData.forEach((item) => {
      grouped[item.weekday].push({
        hour: item.hour,
        median_count: item.median_count,
        max_capacity: item.max_capacity,
      });
    });

    Object.values(grouped).forEach((dayArray) => {
      dayArray.sort((a, b) => a.hour - b.hour);
    });

    return grouped;
  }, [chartData]);

  return (
    <Tabs value={selectedRange} onValueChange={(v) => setSelectedRange(v as RangeKey)}>
      <Card className="mb-12 border-border/70 bg-card/90">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Auslastungsmuster</CardTitle>
          <TabsList>
            <TabsTrigger value="30D">30D</TabsTrigger>
            <TabsTrigger value="1Y">1Y</TabsTrigger>
            <TabsTrigger value="ALL">Alltime</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <GymChart data={chartData} weekdayOrder={weekdayOrder} maxCapacity={maxCapacity} />
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/90">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Stündliche Auslastung nach Wochentag</CardTitle>
          <TabsList>
            <TabsTrigger value="30D">30D</TabsTrigger>
            <TabsTrigger value="1Y">1Y</TabsTrigger>
            <TabsTrigger value="ALL">Alltime</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <div className="space-y-8">
            {weekdayOrder.map((dayIndex) => (
              <div key={dayIndex} className="border-b border-border pb-8 last:border-0">
                <h3 className="mb-4 text-lg font-semibold">
                  {WEEKDAY_NAMES[dayIndex]} ({WEEKDAYS[dayIndex]})
                </h3>

                {dataByWeekday[dayIndex].length === 0 ? (
                  <p className="text-muted-foreground">Keine Daten verfugbar</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {Array.from({ length: 24 }).map((_, hour) => {
                      const data = dataByWeekday[dayIndex].find((d) => d.hour === hour);
                      if (!data) return null;

                      const percent = maxCapacity > 0 ? (data.median_count / maxCapacity) * 100 : 0;

                      let colorClass = "bg-emerald-100 text-emerald-950";
                      if (percent >= 80) colorClass = "bg-red-100 text-red-950";
                      else if (percent >= 50) colorClass = "bg-amber-100 text-amber-950";

                      return (
                        <div key={hour} className={`rounded-lg p-3 text-center transition-colors ${colorClass}`}>
                          <p className="text-sm font-semibold">{hour}:00</p>
                          <p className="text-lg font-bold">{Math.round(data.median_count)}</p>
                          <p className="text-xs opacity-75">{percent.toFixed(0)}%</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Tabs>
  );
}
