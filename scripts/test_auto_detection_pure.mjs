import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const csvPath = path.join(__dirname, '../test/Occupancy.csv')

function parseBerlinDate(tsStr) {
  let s = tsStr.replace(' ', 'T')
  if (!s.endsWith('Z')) s += 'Z'
  const d = new Date(s)
  // Berlin is UTC+2 during CEST
  const utc = d.getTime()
  // format using Intl
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(d)
  const getPart = (t) => parts.find((p) => p.type === t)?.value ?? ''
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    dayKey: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
    weekday: weekdayMap[getPart('weekday')],
    hour: Number(getPart('hour')),
    minute: Number(getPart('minute')),
    timestamp: d,
  }
}

async function loadData() {
  const gymData = new Map() // gymId -> Map(dayKey -> { weekday, hourlyValues: Map(hour -> number[]) })

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath),
    crlfDelay: Infinity,
  })

  let isHeader = true
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    const [id, gymId, countStr, maxCountStr, tsStr] = line.split(',')
    if (!gymId || !countStr || !tsStr) continue

    const { dayKey, weekday, hour } = parseBerlinDate(tsStr)
    const count = parseInt(countStr, 10)

    if (!gymData.has(gymId)) gymData.set(gymId, new Map())
    const days = gymData.get(gymId)
    if (!days.has(dayKey)) days.set(dayKey, { weekday, hourlyValues: new Map() })
    const day = days.get(dayKey)
    if (!day.hourlyValues.has(hour)) day.hourlyValues.set(hour, [])
    day.hourlyValues.get(hour).push(count)
  }

  return gymData
}

export function inferOpeningHoursPure(dayBuckets) {
  // Aggregate turnover across all days for each (weekday, hour)
  const wdHourChanges = Array.from({ length: 7 }, () => Array(24).fill(0))
  const wdHourTotals = Array.from({ length: 7 }, () => Array(24).fill(0))

  for (const bucket of dayBuckets.values()) {
    const wd = bucket.weekday
    for (const [h, vals] of bucket.hourlyValues.entries()) {
      if (vals.length > 1) {
        let ch = 0
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] !== vals[i - 1]) ch++
        }
        wdHourChanges[wd][h] += ch
        wdHourTotals[wd][h] += vals.length - 1
      }
    }
  }

  const result = {}

  for (let wd = 0; wd < 7; wd++) {
    const activeHours = []
    for (let h = 0; h < 24; h++) {
      const tot = wdHourTotals[wd][h]
      const ch = wdHourChanges[wd][h]
      const rate = tot > 0 ? ch / tot : 0
      // An hour is active if turnover rate >= 25%
      if (rate >= 0.25) {
        activeHours.push(h)
      }
    }

    const nightActive = [0, 1, 2, 3, 4].filter((h) => activeHours.includes(h)).length
    if (activeHours.length >= 22 && nightActive >= 3) {
      result[wd] = { open: 0, close: 23, is24h: true }
    } else if (activeHours.length > 0) {
      result[wd] = {
        open: Math.min(...activeHours),
        close: Math.max(...activeHours),
        is24h: false,
      }
    } else {
      result[wd] = null
    }
  }

  return result
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`)
    process.exit(1)
  }
  console.log(`✓ ${message}`)
}

async function main() {
  console.log('Loading database export...')
  const gymData = await loadData()
  console.log(`Loaded data for ${gymData.size} gyms.\n`)

  console.log('--- Checking Automatic Opening Hours Inference ---')
  for (const [gymId, days] of gymData.entries()) {
    const inferred = inferOpeningHoursPure(days)
    console.log(`\nStudio: ${gymId}`)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    for (let wd = 0; wd < 7; wd++) {
      const inf = inferred[wd]
      if (inf?.is24h) {
        console.log(`  ${dayNames[wd]}: 24h geöffnet (00:00 - 24:00)`)
      } else if (inf) {
        console.log(`  ${dayNames[wd]}: ${String(inf.open).padStart(2, '0')}:00 - ${String(inf.close + 1).padStart(2, '0')}:00 (open ${inf.open}..${inf.close})`)
      } else {
        console.log(`  ${dayNames[wd]}: Geschlossen`)
      }
    }

    if (gymId === 'freiburg-west') {
      // Verify Mon-Fri (1..5) is 07:00-23:00 (open 7..22)
      for (let wd = 1; wd <= 5; wd++) {
        assert(inferred[wd].open === 7 && inferred[wd].close === 22, `FW wd ${wd} must be 7..22`)
      }
      // Verify Sat-Sun (6, 0) is 08:00-21:00 (open 8..20)
      assert(inferred[6].open === 8 && inferred[6].close === 20, 'FW Sat must be 8..20')
      assert(inferred[0].open === 8 && inferred[0].close === 20, 'FW Sun must be 8..20')
    }

    if (gymId === 'karlsruhe-sued') {
      for (let wd = 0; wd < 7; wd++) {
        assert(inferred[wd].is24h === true, `KS wd ${wd} must be 24h`)
      }
    }
  }

  console.log('\n🎉 ALL PURE AUTO-INFERENCE TESTS PASSED 100%!')
}

main().catch(console.error)
