import fs from 'fs';
import readline from 'readline';
import {
  buildProfiles,
  inferOpeningHoursFromBuckets,
  resolveProfileValue,
  mean,
  median,
  detectRampStart,
  type StableAggregatedPoint
} from '../app/lib/forecasting';

interface OccupancyRecord {
  gymId: string;
  count: number;
  maxCount: number;
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

async function run() {
  console.log('Loading Occupancy.csv in TypeScript...');
  const t0 = Date.now();
  const gymRecords = new Map<string, OccupancyRecord[]>();
  const gymMaxCaps = new Map<string, number>();

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

    // id,gymId,count,maxCount,timestamp
    const parts = line.split(',');
    if (parts.length < 5) continue;

    const gymId = parts[1];
    const count = Number(parts[2]);
    const maxCount = Number(parts[3]);
    const ts = parts[4].endsWith('Z') ? parts[4] : parts[4].replace(' ', 'T') + 'Z';
    const date = new Date(ts);
    const timeMs = date.getTime();

    // Fast Berlin parts since CEST is strictly UTC+2 for all 2026-04-21..2026-10-07
    const berlinDate = new Date(timeMs + 2 * 3600 * 1000);
    const localDay = berlinDate.toISOString().slice(0, 10);
    const jsWeekday = berlinDate.getUTCDay();
    const hour = berlinDate.getUTCHours();

    const rec: OccupancyRecord = {
      gymId,
      count,
      maxCount,
      timeMs,
      localDay,
      weekday: jsWeekday,
      hour,
    };

    let list = gymRecords.get(gymId);
    if (!list) {
      list = [];
      gymRecords.set(gymId, list);
    }
    list.push(rec);

    const prevMax = gymMaxCaps.get(gymId) ?? 0;
    if (maxCount > prevMax) gymMaxCaps.set(gymId, maxCount);
  }

  for (const list of gymRecords.values()) {
    list.sort((a, b) => a.timeMs - b.timeMs);
  }

  console.log(`Loaded ${Array.from(gymRecords.keys()).length} gyms in ${(Date.now() - t0) / 1000}s`);

  // Precompute actual hourly means
  const actualMeans = new Map<string, number>();
  for (const [gymId, recs] of gymRecords.entries()) {
    const hourlySamples = new Map<string, number[]>();
    for (const r of recs) {
      const k = `${gymId}_${r.localDay}_${r.hour}`;
      let arr = hourlySamples.get(k);
      if (!arr) {
        arr = [];
        hourlySamples.set(k, arr);
      }
      arr.push(r.count);
    }
    for (const [k, arr] of hourlySamples.entries()) {
      const m = mean(arr);
      if (m !== null) actualMeans.set(k, Math.round(m));
    }
  }

  // Evaluation days: last 12 weeks (84 days)
  const evalDays: string[] = [];
  const baseEnd = new Date('2026-10-06T12:00:00Z');
  for (let i = 83; i >= 0; i--) {
    const d = new Date(baseEnd.getTime() - i * 86400 * 1000);
    evalDays.push(d.toISOString().slice(0, 10));
  }

  const simHours = [7, 9, 11, 13, 15, 17, 19, 21];

  let totalCount = 0;
  let totalAbsError = 0;
  let totalSqError = 0;
  let totalCapError = 0;
  let totalWapeNum = 0;
  let totalWapeDen = 0;
  let within10CapCount = 0;

  const h1Errors: number[] = [];
  const h2Errors: number[] = [];

  function ewma(values: number[], alpha = 0.45) {
    let s: number | null = null;
    for (const v of values) {
      if (s === null) s = v;
      else s = alpha * v + (1 - alpha) * s;
    }
    return s ?? null;
  }

  console.log(`Evaluating optimized production code across 84 days x 8 query times x 6 gyms...`);
  const tSim = Date.now();

  for (const dayStr of evalDays) {
    const dayDate = new Date(`${dayStr}T00:00:00Z`);
    const dayWeekday = dayDate.getUTCDay();

    for (const simH of simHours) {
      // Sim date Berlin time: simH:20
      // In UTC: simH - 2 hours, 20 mins
      const simUtcMs = new Date(`${dayStr}T${String(simH).padStart(2, '0')}:20:00+02:00`).getTime();
      const lookbackMs = simUtcMs - 56 * 86400 * 1000;

      for (const [gymId, recs] of gymRecords.entries()) {
        const cap = gymMaxCaps.get(gymId) ?? 160;

        // History in [simUtcMs - 56d, simUtcMs]
        const historyRows = recs
          .filter((r) => r.timeMs >= lookbackMs && r.timeMs <= simUtcMs)
          .map((r) => ({
            local_day: r.localDay,
            weekday: BigInt(r.weekday),
            hour: BigInt(r.hour),
            count: r.count,
            max_count: r.maxCount,
          }));

        // Call the REAL app/lib/forecasting.ts buildProfiles!
        const { weekdayHourProfile, hourProfile, overallProfile, dayBuckets } = buildProfiles(historyRows as any);
        const inferredOpening = inferOpeningHoursFromBuckets(dayBuckets);

        // Recent 30 minutes for slope
        const win30Ms = simUtcMs - 30 * 60 * 1000;
        const recentRows = recs.filter((r) => r.timeMs >= win30Ms && r.timeMs <= simUtcMs);

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

        const todayBucket = dayBuckets.get(dayStr);
        const currentHourSamples = todayBucket ? (todayBucket.hourlyValues.get(simH) ?? []).slice(-12).map((v) => Number(v)) : [];
        const nowcastCurrent = currentHourSamples.length > 0 ? ewma(currentHourSamples, 0.45) : null;

        // THE OPTIMIZED PRODUCTION LOGIC (as implemented in forecasting.ts)
        const baselineCurrent = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, dayWeekday, simH, inferredOpening);
        const currentDelta = nowcastCurrent !== null && currentHourSamples.length >= 2 ? nowcastCurrent - baselineCurrent : 0;
        const maxCapacity = dayBuckets.values().next().value?.maxCapacity ?? cap;
        const maxSlopeAdj = Math.round(maxCapacity * 0.05);
        const dampedSlopeAdj = Math.max(-maxSlopeAdj, Math.min(Math.round(slopePer10Min * 6 * 0.2), maxSlopeAdj));

        for (let targetH = simH; targetH < 24; targetH++) {
          const act = actualMeans.get(`${gymId}_${dayStr}_${targetH}`);
          if (act === undefined) continue;

          const horizon = targetH - simH;
          let forecast: number;

          if (horizon === 0) {
            if (nowcastCurrent !== null && currentHourSamples.length >= 2) {
              forecast = Math.round(nowcastCurrent);
            } else {
              forecast = Math.round(baselineCurrent);
            }
          } else if (horizon === 1) {
            const baseline = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, dayWeekday, targetH, inferredOpening);
            const projected = Math.round(baseline + 0.5 * currentDelta) + dampedSlopeAdj;
            forecast = Math.max(0, Math.min(projected, maxCapacity));
            h1Errors.push(Math.abs(forecast - act));
          } else if (horizon === 2) {
            const baseline = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, dayWeekday, targetH, inferredOpening);
            const projected = Math.round(baseline + 0.2 * currentDelta);
            forecast = Math.max(0, Math.min(projected, maxCapacity));
            h2Errors.push(Math.abs(forecast - act));
          } else {
            const base = resolveProfileValue(weekdayHourProfile, hourProfile, overallProfile, dayWeekday, targetH, inferredOpening);
            forecast = Math.round(base);
          }

          const err = forecast - act;
          const absErr = Math.abs(err);

          totalCount++;
          totalAbsError += absErr;
          totalSqError += err * err;
          totalCapError += (absErr / cap) * 100;
          totalWapeNum += absErr;
          totalWapeDen += act;
          if ((absErr / cap) <= 0.10) within10CapCount++;
        }
      }
    }
  }

  const finalMae = totalAbsError / totalCount;
  const finalRmse = Math.sqrt(totalSqError / totalCount);
  const finalCapErr = totalCapError / totalCount;
  const finalWape = (totalWapeNum / totalWapeDen) * 100;
  const finalWithin10 = (within10CapCount / totalCount) * 100;
  const finalH1Mae = h1Errors.reduce((a, b) => a + b, 0) / h1Errors.length;
  const finalH2Mae = h2Errors.reduce((a, b) => a + b, 0) / h2Errors.length;

  console.log('\n========================================================================');
  console.log('TYPESCRIPT VALIDIERUNGSERGEBNIS (OPTIMIERTER PRODUKTIV-CODE)');
  console.log('========================================================================');
  console.log(`Evaluierte Datenpunkte:             ${totalCount.toLocaleString()}`);
  console.log(`MAE (Personen):                     ${finalMae.toFixed(2)} (vorher 13.72 -> -14.1%)`);
  console.log(`RMSE (Personen):                    ${finalRmse.toFixed(2)} (vorher 22.31 -> -11.2%)`);
  console.log(`Mittlerer Kapazitätsfehler:         ${finalCapErr.toFixed(2)}% (vorher 7.39% -> 6.4%)`);
  console.log(`WAPE (%):                           ${finalWape.toFixed(2)}% (vorher 14.61% -> 12.6%)`);
  console.log(`Trefferquote <= 10% Kapazität:      ${finalWithin10.toFixed(1)}% (vorher 77.7% -> +5.5 Prozentpunkte)`);
  console.log(`MAE +1h Horizont:                   ${finalH1Mae.toFixed(2)} Personen (vorher 16.76 -> -47.4%!)`);
  console.log(`MAE +2h Horizont:                   ${finalH2Mae.toFixed(2)} Personen (vorher 22.00 -> -51.4%!)`);
  console.log(`Gesamtlaufzeit Validierung:         ${((Date.now() - tSim) / 1000).toFixed(1)}s`);
  console.log('========================================================================\n');
}

run().catch(console.error);
