// Node script to compute multi-horizon MAE/MASE for baseline vs nowcast
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')
const { buildProfiles, fetchHistory, resolveProfileValue, inferOpeningHoursFromBuckets } = require('../app/lib/forecasting')

const prisma = new PrismaClient()

async function run(gymId, lookbackDays = 56, horizons = 6) {
  const rows = await fetchHistory(prisma, gymId, lookbackDays)
  const { dayBuckets } = buildProfiles(rows)
  const dayKeys = Array.from(dayBuckets.keys())

  const results = {}
  for (let h = 1; h <= horizons; h++) {
    results[h] = { baselineErrors: [], nowcastErrors: [], naiveErrors: [] }
  }

  for (const dayKey of dayKeys) {
    const otherRows = rows.filter((r) => r.local_day !== dayKey)
    const { weekdayHourProfile: wp2, hourProfile: hp2, overallProfile: op2, dayBuckets: db2 } = buildProfiles(otherRows)
    const bucket = dayBuckets.get(dayKey)
    if (!bucket) continue
    for (let hour = 0; hour < 24; hour++) {
      const vals = bucket.hourlyValues.get(hour) ?? []
      const actual = mean(vals.map((v) => Number(v)))
      if (actual === null) continue

      const baseline = resolveProfileValue(wp2, hp2, op2, bucket.weekday, hour, inferOpeningHoursFromBuckets(db2))

      // build simple nowcast series by projecting previous deltas
      const prevs = []
      for (let p = 1; p <= 6; p++) {
        prevs.push(mean(bucket.hourlyValues.get(hour - p) ?? []) ?? baseline)
      }

      for (let h = 1; h <= horizons; h++) {
        const targetHour = hour + h
        // simple nowcast: baseline + recent delta average
        const recentDelta = (prevs[0] - prevs[1]) || 0
        const nowcast = baseline + recentDelta * Math.min(1, h * 0.5)
        results[h].baselineErrors.push(Math.abs(baseline - actual))
        results[h].nowcastErrors.push(Math.abs(nowcast - actual))
        results[h].naiveErrors.push(Math.abs(actual - prevs[0]))
      }
    }
  }

  const summary = {}
  for (let h = 1; h <= horizons; h++) {
    const b = mean(results[h].baselineErrors)
    const n = mean(results[h].nowcastErrors)
    const denom = mean(results[h].naiveErrors) || 1
    summary[h] = { maeBaseline: b, maeNowcast: n, maseBaseline: b / denom, maseNowcast: n / denom }
  }

  const out = { gymId, lookbackDays, horizons, summary }
  const outPath = path.join(process.cwd(), 'eval_results', `${gymId}-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('Wrote', outPath)
  await prisma.$disconnect()
}

function mean(values) {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length === 0) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

if (require.main === module) {
  const gymId = process.argv[2]
  if (!gymId) {
    console.error('Usage: node scripts/eval_nowcast.js <gymId> [lookbackDays] [horizons]')
    process.exit(1)
  }
  const lookback = process.argv[3] ? Number(process.argv[3]) : 56
  const horizons = process.argv[4] ? Number(process.argv[4]) : 6
  run(gymId, lookback, horizons).catch((e) => { console.error(e); process.exit(1) })
}
