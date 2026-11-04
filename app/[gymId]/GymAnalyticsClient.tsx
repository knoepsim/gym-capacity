"use client";

import { useMemo, useState } from "react";
import { GymChart } from "@/app/components/GymChart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  OCCUPANCY_LEVEL_BADGE,
  OCCUPANCY_LEVEL_LABEL,
  OCCUPANCY_LEVEL_RANGE,
  OCCUPANCY_LEVEL_SURFACE,
  occupancyLevel,
  type OccupancyLevel,
} from "@/app/lib/occupancyLevel";

interface ProfilePoint {
  weekday: number;
  hour: number;
  median_count: number;
  max_capacity: number;
}

interface GymAnalyticsClientProps {
  /** Typical value per weekday and hour over the last 30 days. */
  profile: ProfilePoint[];
  currentWeekday: number;
  maxCapacity: number;
  unit?: 'persons' | 'percent';
}

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const LEVELS: OccupancyLevel[] = ["low", "moderate", "high"];

// Weekly planner: pick a weekday, see each hour coloured by how busy it usually is.
export function GymAnalyticsClient({ profile, currentWeekday, maxCapacity, unit = 'persons' }: GymAnalyticsClientProps) {
  const [selectedDay, setSelectedDay] = useState<number>(currentWeekday);

  const fullDay = useMemo(
    () => profile.filter((point) => point.weekday === selectedDay).sort((a, b) => a.hour - b.hour),
    [profile, selectedDay]
  );
  // Closed hours (typical value 0) carry no planning information in the hour grid
  const dayData = useMemo(() => fullDay.filter((point) => point.median_count > 0), [fullDay]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Typische Woche</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <ToggleGroup
          type="single"
          variant="outline"
          value={String(selectedDay)}
          onValueChange={(value) => value && setSelectedDay(Number(value))}
          aria-label="Wochentag"
          className="flex-wrap"
        >
          {WEEK_ORDER.map((day) => (
            <ToggleGroupItem key={day} value={String(day)} aria-label={WEEKDAY_NAMES[day]} className="w-11">
              {WEEKDAY_SHORT[day]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {dayData.length === 0 ? (
          <Empty className="p-4">
            <EmptyHeader>
              <EmptyTitle>Keine Daten für {WEEKDAY_NAMES[selectedDay]}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
          <GymChart data={fullDay} unit={unit} />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-9">
            {dayData.map((data) => {
              const percent = maxCapacity > 0 ? (data.median_count / maxCapacity) * 100 : 0;
              const level = occupancyLevel(percent);

              return (
                <div
                  key={data.hour}
                  className={cn("flex flex-col items-center gap-0.5 rounded-lg p-2 text-center", OCCUPANCY_LEVEL_SURFACE[level])}
                  title={`${OCCUPANCY_LEVEL_LABEL[level]} (${percent.toFixed(0)} %)`}
                >
                  <span className="text-xs text-muted-foreground tabular-nums">{String(data.hour).padStart(2, "0")}:00</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {unit === 'percent' ? `${percent.toFixed(0)}%` : Math.round(data.median_count)}
                  </span>
                </div>
              );
            })}
          </div>
          </>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        {LEVELS.map((level) => (
          <Badge key={level} variant={OCCUPANCY_LEVEL_BADGE[level]}>
            {OCCUPANCY_LEVEL_LABEL[level]} · {OCCUPANCY_LEVEL_RANGE[level]}
          </Badge>
        ))}
      </CardFooter>
    </Card>
  );
}
