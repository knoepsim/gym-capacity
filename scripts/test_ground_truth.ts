import fs from 'fs';
import readline from 'readline';
import { buildProfiles, inferOpeningHoursFromBuckets, resolveProfileValue, mean } from '../app/lib/forecasting';

interface OccupancyRecord {
  id: number;
  gymId: string;
  count: number;
  maxCount: number;
  timestamp: string; // ISO or date string
  date: Date;
  timeMs: number;
  localDay: string;
  weekday: number;
  hour: number;
}

const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getBerlinDateParts(date: Date) {
  const localDay = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(date);

  const weekdayStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Europe/Berlin',
  }).format(date);

  const hourStr = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Europe/Berlin',
  }).format(date);

  return {
    localDay,
    weekday: weekdayMap[weekdayStr] ?? 0,
    hour: Number(hourStr),
  };
}

async function loadData(): Promise<Map<string, OccupancyRecord[]>> {
  const gymRecords = new Map<string, OccupancyRecord[]>();
  const fileStream = fs.createReadStream('test/Occupancy.csv');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (!line.trim()) continue;

    // Format: id,gymId,count,maxCount,timestamp
    const parts = line.split(',');
    if (parts.length < 5) continue;

    const id = Number(parts[0]);
    const gymId = parts[1];
    const count = Number(parts[2]);
    const maxCount = Number(parts[3]);
    const tsStr = parts[4].endsWith('Z') ? parts[4] : parts[4].replace(' ', 'T') + 'Z';
    const date = new Date(tsStr);
    const timeMs = date.getTime();

    const { localDay, weekday, hour } = getBerlinDateParts(date);

    const rec: OccupancyRecord = {
      id,
      gymId,
      count,
      maxCount,
      timestamp: tsStr,
      date,
      timeMs,
      localDay,
      weekday,
      hour,
    };

    let list = gymRecords.get(gymId);
    if (!list) {
      list = [];
      gymRecords.set(gymId, list);
    }
    list.push(rec);
  }

  // Sort each gym's records by timeMs
  for (const list of gymRecords.values()) {
    list.sort((a, b) => a.timeMs - b.timeMs);
  }

  return gymRecords;
}

function simulateForecastAt(
  allGymRecords: OccupancyRecord[],
  simulatedNow: Date
) {
  const nowMs = simulatedNow.getTime();
  const lookbackMs = nowMs - 56 * 24 * 60 * 60 * 1000;

  // Filter records within lookback window [nowMs - 56d, nowMs]
  // In fetchHistory: timestamp >= NOW() - 56 days (and <= NOW())
  const historyRows = allGymRecords
    .filter((r) => r.timeMs >= lookbackMs && r.timeMs <= nowMs)
    .map((r) => ({
      local_day: r.localDay,
      weekday: BigInt(r.weekday),
      hour: BigInt(r.hour),
      count: r.count,
      max_count: r.maxCount,
    }));

  const { weekdayHourProfile, hourProfile, overallProfile, dayBuckets } = buildProfiles(historyRows as any);
  const inferredOpening = inferOpeningHoursFromBuckets(dayBuckets);

  const { localDay: todayKey, weekday: todayWeekday, hour: currentHourBerlin } = getBerlinDateParts(simulatedNow);
  const todayBucket = dayBuckets.get(todayKey);

  // Recent rows in last 30 minutes: timestamp >= NOW() - 30 minutes
  const window30mMs = nowMs - 30 * 60 * 1000;
  const recentRows = allGymRecords.filter((r) => r.timeMs >= window30mMs && r.timeMs <= nowMs);

  let slopePer10Min = 0;
  if (recentRows.length >= 3) {
    const times = recentRows.map((r) => r.timeMs / 60000);
    const vals = recentRows.map((r) => r.count);
    const n = vals.length;
    const meanT = times.reduce((a, b) => a + b, 0) / n;
    const meanV = vals.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (times[i] - meanT) * (vals[i] - meanV);
      den += (times[i] - meanT) * (times[i] - meanT);
    }
    const slopePerMinute = den === 0 ? 0 : num / den;
    slopePer10Min = slopePerMinute * 10;
  }

  const actualByHour = new Map<number, number>();
  if (todayBucket) {
    for (const [hour, values] of todayBucket.hourlyValues.entries()) {
      const val = mean(values);
      if (val !== null) {
        actualByHour.set(hour, val);
      }
    }
  }

  function ewma(values: number[], alpha = 0.4) {
    let s: number | null = null;
    for (const v of values) {
      if (s === null) s = v;
      else s = alpha * v + (1 - alpha) * s;
    }
    return s ?? null;
  }

  const currentHourSamples = todayBucket ? (todayBucket.hourlyValues.get(currentHourBerlin) ?? []).slice(-12).map((v) => Number(v)) : [];
  const nowcastCurrent = currentHourSamples.length > 0 ? ewma(currentHourSamples, 0.45) : null;

  const series = Array.from({ length: 24 }, (_, hour) => {
    const actual = actualByHour.get(hour) ?? null;
    let forecast: number | null = null;

    if (hour < currentHourBerlin) {
      forecast = null;
    } else if (hour === currentHourBerlin) {
      if (nowcastCurrent !== null && currentHourSamples.length >= 2) {
        forecast = Math.round(nowcastCurrent);
      } else {
        forecast = Math.round(resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, todayWeekday, hour, inferredOpening));
      }
    } else if (hour === currentHourBerlin + 1) {
      const baseline = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, todayWeekday, hour, inferredOpening);
      if (nowcastCurrent !== null && currentHourSamples.length >= 3) {
        const weightNow = 0.7;
        const blended = Math.round(weightNow * nowcastCurrent + (1 - weightNow) * baseline);
        const slopeAdj = Math.round(slopePer10Min * 6);
        const maxCap = dayBuckets.values().next().value?.maxCapacity ?? blended + slopeAdj;
        forecast = Math.max(0, Math.min(blended + slopeAdj, maxCap));
      } else {
        const slopeAdj = Math.round(slopePer10Min * 6);
        const maxCap = dayBuckets.values().next().value?.maxCapacity ?? Math.round(baseline) + slopeAdj;
        forecast = Math.max(0, Math.min(Math.round(baseline) + slopeAdj, maxCap));
      }
    } else {
      const base = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, todayWeekday, hour, inferredOpening);
      if (hour === currentHourBerlin + 2) {
        const slopeAdj = Math.round(slopePer10Min * 12 * 0.5);
        const maxCap = dayBuckets.values().next().value?.maxCapacity ?? Math.round(base) + slopeAdj;
        forecast = Math.max(0, Math.min(Math.round(base) + slopeAdj, maxCap));
      } else {
        forecast = Math.round(base);
      }
    }

    return {
      hour,
      actual_count: actual !== null ? Math.round(actual) : null,
      forecast_count: forecast,
    };
  });

  return { series, inferredOpening, slopePer10Min, nowcastCurrent };
}

async function run() {
  console.log('Loading CSV data...');
  const data = await loadData();
  console.log('Loaded gyms:', Array.from(data.keys()));

  // Compare with GymAnalyticsCache.csv for karlsruhe-sued
  // Cache timestamp: 2026-10-07 08:16:50.574 UTC
  const testDate = new Date('2026-10-07T08:16:50.574Z');
  const ksRecords = data.get('karlsruhe-sued')!;
  const res = simulateForecastAt(ksRecords, testDate);

  console.log('Simulated for karlsruhe-sued at', testDate.toISOString());
  console.log('Series:');
  console.log(JSON.stringify(res.series));
}

run().catch(console.error);
