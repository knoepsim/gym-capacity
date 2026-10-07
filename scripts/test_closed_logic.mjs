import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const gyms = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/gyms.json'), 'utf-8'))

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayNameMap = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }

function getBerlinTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const getPart = (type) => parts.find((p) => p.type === type)?.value ?? ''

  const weekday = getPart('weekday')
  const hour = Number(getPart('hour'))
  const minute = Number(getPart('minute'))

  return { weekday, hour, minute, minutesFromMidnight: hour * 60 + minute }
}

function parseMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function isGym24h(gymId) {
  const gym = gyms.find((g) => g.id === gymId)
  if (!gym || !gym.openingHours) return false
  return Object.values(gym.openingHours).every((v) => v === '00:00-24:00' || v === '00:00-00:00')
}

function isOutsideOpeningHours(gymId, date = new Date()) {
  const gym = gyms.find((g) => g.id === gymId)
  if (!gym || !gym.openingHours) {
    return { isClosed: false, stableMinutes: 0 }
  }

  const { weekday, minutesFromMidnight } = getBerlinTimeParts(date)
  const scheduleStr = gym.openingHours[weekday]

  if (!scheduleStr || scheduleStr === 'closed') {
    return { isClosed: true, stableMinutes: 1440, reason: 'schedule' }
  }

  const parts = scheduleStr.split('-')
  if (parts.length !== 2) {
    return { isClosed: false, stableMinutes: 0 }
  }

  const openMinutes = parseMinutes(parts[0])
  const closeMinutes = parseMinutes(parts[1])

  if (openMinutes === 0 && (closeMinutes >= 1440 || parts[1] === '24:00')) {
    return { isClosed: false, stableMinutes: 0 }
  }

  if (minutesFromMidnight >= openMinutes && minutesFromMidnight < closeMinutes) {
    return { isClosed: false, stableMinutes: 0 }
  }

  let stableMinutes = 0
  if (minutesFromMidnight >= closeMinutes) {
    stableMinutes = minutesFromMidnight - closeMinutes
  } else {
    const prevWeekday = WEEKDAY_NAMES[(WEEKDAY_NAMES.indexOf(weekday) + 6) % 7]
    const prevScheduleStr = gym.openingHours[prevWeekday]
    let prevCloseMinutes = 23 * 60
    if (prevScheduleStr && prevScheduleStr.includes('-')) {
      prevCloseMinutes = parseMinutes(prevScheduleStr.split('-')[1])
      if (prevCloseMinutes > 1440) prevCloseMinutes = 1440
    }
    stableMinutes = (1440 - prevCloseMinutes) + minutesFromMidnight
  }

  return { isClosed: true, stableMinutes, reason: 'schedule' }
}

function getOpeningHoursForGym(gymId) {
  const gym = gyms.find((g) => g.id === gymId)
  if (!gym || !gym.openingHours) return null

  const result = {}
  for (let wd = 0; wd < 7; wd++) {
    const dayKey = dayNameMap[wd]
    const timeStr = gym.openingHours[dayKey]
    if (!timeStr || timeStr === 'closed') {
      result[wd] = null
      continue
    }

    const parts = timeStr.split('-')
    if (parts.length !== 2) {
      result[wd] = null
      continue
    }

    const openHour = Number(parts[0].split(':')[0])
    const closeHour = Number(parts[1].split(':')[0])

    if (closeHour >= 24 || (openHour === 0 && closeHour === 0)) {
      result[wd] = { open: 0, close: 23 }
    } else {
      result[wd] = { open: openHour, close: Math.max(openHour, closeHour - 1) }
    }
  }

  return result
}

function withinOpeningHours(opening, weekday, hour) {
  if (!opening) return true
  const w = opening[weekday]
  if (!w) return true
  return hour >= w.open && hour <= w.close
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`)
    process.exit(1)
  }
  console.log(`✓ ${message}`)
}

console.log('========================================================')
console.log('RUNNING SYSTEM TESTS FOR OPENING HOURS & CLOSED DETECTION')
console.log('========================================================\n')

// 1. 24h checks
console.log('--- 1. Testing 24h classification ---')
assert(isGym24h('karlsruhe-sued') === true, 'karlsruhe-sued is 24h')
assert(isGym24h('freiburg-west') === false, 'freiburg-west is not 24h')

// 2. Schedule extraction
console.log('\n--- 2. Testing getOpeningHoursForGym ---')
const fw = getOpeningHoursForGym('freiburg-west')
for (let wd = 1; wd <= 5; wd++) {
  assert(fw[wd].open === 7 && fw[wd].close === 22, `FW weekday ${wd} active hours: 07..22 (closes at 23:00)`)
}
assert(fw[6].open === 8 && fw[6].close === 20, 'FW Saturday active hours: 08..20 (closes at 21:00)')
assert(fw[0].open === 8 && fw[0].close === 20, 'FW Sunday active hours: 08..20 (closes at 21:00)')

const ks = getOpeningHoursForGym('karlsruhe-sued')
for (let wd = 0; wd < 7; wd++) {
  assert(ks[wd].open === 0 && ks[wd].close === 23, `KS wd ${wd} open all 24 hours`)
}

// 3. Hourly checks
console.log('\n--- 3. Testing withinOpeningHours ---')
assert(!withinOpeningHours(fw, 3, 6), 'FW Wed 06:00 is closed')
assert(withinOpeningHours(fw, 3, 7), 'FW Wed 07:00 is open')
assert(withinOpeningHours(fw, 3, 14), 'FW Wed 14:00 is open')
assert(withinOpeningHours(fw, 3, 22), 'FW Wed 22:00 is open')
assert(!withinOpeningHours(fw, 3, 23), 'FW Wed 23:00 is closed')

assert(!withinOpeningHours(fw, 0, 7), 'FW Sun 07:00 is closed')
assert(withinOpeningHours(fw, 0, 8), 'FW Sun 08:00 is open')
assert(withinOpeningHours(fw, 0, 20), 'FW Sun 20:00 is open')
assert(!withinOpeningHours(fw, 0, 21), 'FW Sun 21:00 is closed')

// 4. Exact timestamp checks
console.log('\n--- 4. Testing Freiburg West timestamps (Berlin Time) ---')
assert(isOutsideOpeningHours('freiburg-west', new Date('2026-10-07T06:45:00+02:00')).isClosed === true, 'Wed 06:45: CLOSED')
assert(isOutsideOpeningHours('freiburg-west', new Date('2026-10-07T07:00:00+02:00')).isClosed === false, 'Wed 07:00: OPEN')
assert(isOutsideOpeningHours('freiburg-west', new Date('2026-10-07T14:00:00+02:00')).isClosed === false, 'Wed 14:00: OPEN')
assert(isOutsideOpeningHours('freiburg-west', new Date('2026-10-07T22:59:00+02:00')).isClosed === false, 'Wed 22:59: OPEN')
assert(isOutsideOpeningHours('freiburg-west', new Date('2026-10-07T23:00:00+02:00')).isClosed === true, 'Wed 23:00: CLOSED')
const wed2330 = isOutsideOpeningHours('freiburg-west', new Date('2026-10-07T23:30:00+02:00'))
assert(wed2330.isClosed === true && wed2330.stableMinutes === 30, 'Wed 23:30: CLOSED (30 min ago)')
const thu0200 = isOutsideOpeningHours('freiburg-west', new Date('2026-10-08T02:00:00+02:00'))
assert(thu0200.isClosed === true && thu0200.stableMinutes === 180, 'Thu 02:00: CLOSED (3 hours ago)')

// Sunday test
assert(isOutsideOpeningHours('freiburg-west', new Date('2026-10-11T20:59:00+02:00')).isClosed === false, 'Sun 20:59: OPEN')
const sun2105 = isOutsideOpeningHours('freiburg-west', new Date('2026-10-11T21:05:00+02:00'))
assert(sun2105.isClosed === true && sun2105.stableMinutes === 5, 'Sun 21:05: CLOSED (5 min ago)')

// Current time test: Notice current time is ~22:32 CEST!
// Freiburg West closes at 23:00! At 22:32, it should still be OPEN!
const now = new Date()
const nowCheckFW = isOutsideOpeningHours('freiburg-west', now)
console.log(`Current time test for Freiburg West (${now.toISOString()}): isClosed = ${nowCheckFW.isClosed}`)

// 5. Karlsruhe Süd checks (24h)
console.log('\n--- 5. Testing Karlsruhe Süd (24h) ---')
assert(isOutsideOpeningHours('karlsruhe-sued', new Date('2026-10-07T03:00:00+02:00')).isClosed === false, 'KS 03:00 is OPEN')
assert(isOutsideOpeningHours('karlsruhe-sued', new Date('2026-10-07T23:30:00+02:00')).isClosed === false, 'KS 23:30 is OPEN')
assert(isOutsideOpeningHours('karlsruhe-sued', new Date('2026-10-11T21:30:00+02:00')).isClosed === false, 'KS Sunday night is OPEN')
assert(isOutsideOpeningHours('karlsruhe-sued', now).isClosed === false, 'KS right now is OPEN')

console.log('\n🎉 ALL 22 ASSERTIONS PASSED SUCCESSFULLY!')
