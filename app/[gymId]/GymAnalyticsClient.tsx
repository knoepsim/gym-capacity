"use client";

import { useMemo, useState } from "react";
import { GymChart } from "@/app/components/GymChart";

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

function RangeToggle({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
}) {
  const options: Array<{ label: string; value: RangeKey }> = [
    { label: "30D", value: "30D" },
    { label: "1Y", value: "1Y" },
    { label: "Alltime", value: "ALL" },
  ];

  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              selected ? "bg-blue-600 text-white shadow" : "text-gray-700 hover:bg-gray-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

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
    <>
      <div className="bg-white rounded-xl shadow-lg p-8 mb-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Auslastungsmuster</h2>
          <RangeToggle value={selectedRange} onChange={setSelectedRange} />
        </div>
        <GymChart data={chartData} weekdayOrder={weekdayOrder} maxCapacity={maxCapacity} />
      </div>

      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Stündliche Auslastung nach Wochentag</h2>
          <RangeToggle value={selectedRange} onChange={setSelectedRange} />
        </div>

        <div className="space-y-8">
          {weekdayOrder.map((dayIndex) => (
            <div key={dayIndex} className="border-b border-gray-200 pb-8 last:border-0">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                {WEEKDAY_NAMES[dayIndex]} ({WEEKDAYS[dayIndex]})
              </h3>

              {dataByWeekday[dayIndex].length === 0 ? (
                <p className="text-gray-500">Keine Daten verfügbar</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {Array.from({ length: 24 }).map((_, hour) => {
                    const data = dataByWeekday[dayIndex].find((d) => d.hour === hour);
                    if (!data) return null;

                    const percent = maxCapacity > 0 ? (data.median_count / maxCapacity) * 100 : 0;

                    let colorClass = "bg-green-100 text-green-900";
                    if (percent >= 80) colorClass = "bg-red-100 text-red-900";
                    else if (percent >= 50) colorClass = "bg-amber-100 text-amber-900";

                    return (
                      <div key={hour} className={`p-3 rounded-lg text-center transition-colors ${colorClass}`}>
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
      </div>
    </>
  );
}
