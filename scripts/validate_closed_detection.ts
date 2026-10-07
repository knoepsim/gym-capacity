import { isOutsideOpeningHours, isGym24h, getBerlinTimeParts } from '../app/lib/closedStatus'
import { withinOpeningHours, type OpeningHours } from '../app/lib/forecasting'

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`)
    process.exit(1)
  }
  console.log(`✓ ${message}`)
}

console.log('========================================================')
console.log('VALIDATING AUTOMATIC OPENING HOURS & CLOSED DETECTION')
console.log('========================================================\n')

// Inferred opening hours for Freiburg West (Mon-Fri 07:00-23:00 -> 7..22, Sat-Sun 08:00-21:00 -> 8..20)
const fwHours: OpeningHours = {
  0: { open: 8, close: 20, is24h: false }, // Sun
  1: { open: 7, close: 22, is24h: false }, // Mon
  2: { open: 7, close: 22, is24h: false }, // Tue
  3: { open: 7, close: 22, is24h: false }, // Wed
  4: { open: 7, close: 22, is24h: false }, // Thu
  5: { open: 7, close: 22, is24h: false }, // Fri
  6: { open: 8, close: 20, is24h: false }, // Sat
}

// Inferred opening hours for Karlsruhe Süd (24h)
const ksHours: OpeningHours = {
  0: { open: 0, close: 23, is24h: true },
  1: { open: 0, close: 23, is24h: true },
  2: { open: 0, close: 23, is24h: true },
  3: { open: 0, close: 23, is24h: true },
  4: { open: 0, close: 23, is24h: true },
  5: { open: 0, close: 23, is24h: true },
  6: { open: 0, close: 23, is24h: true },
}

// 1. Verify 24h classification
console.log('--- 1. Testing isGym24h from Inferred Hours ---')
assert(isGym24h(ksHours) === true, 'karlsruhe-sued should be recognized as 24h')
assert(isGym24h(fwHours) === false, 'freiburg-west should NOT be 24h')

// 2. Test withinOpeningHours
console.log('\n--- 2. Testing withinOpeningHours ---')
// Freiburg West: Wednesday (wd 3)
assert(!withinOpeningHours(fwHours, 3, 5), 'FW Wed 05:00 should NOT be within opening hours')
assert(!withinOpeningHours(fwHours, 3, 6), 'FW Wed 06:00 should NOT be within opening hours')
assert(withinOpeningHours(fwHours, 3, 7), 'FW Wed 07:00 SHOULD be within opening hours')
assert(withinOpeningHours(fwHours, 3, 14), 'FW Wed 14:00 SHOULD be within opening hours')
assert(withinOpeningHours(fwHours, 3, 22), 'FW Wed 22:00 SHOULD be within opening hours')
assert(!withinOpeningHours(fwHours, 3, 23), 'FW Wed 23:00 should NOT be within opening hours (closes at 23:00)')

// Freiburg West: Sunday (wd 0)
assert(!withinOpeningHours(fwHours, 0, 7), 'FW Sun 07:00 should NOT be within opening hours')
assert(withinOpeningHours(fwHours, 0, 8), 'FW Sun 08:00 SHOULD be within opening hours')
assert(withinOpeningHours(fwHours, 0, 20), 'FW Sun 20:00 SHOULD be within opening hours')
assert(!withinOpeningHours(fwHours, 0, 21), 'FW Sun 21:00 should NOT be within opening hours (closes at 21:00)')

// Karlsruhe Süd: All 24 hours open
for (let h = 0; h < 24; h++) {
  assert(withinOpeningHours(ksHours, 3, h), `KS Wed hour ${h} should be open`)
  assert(withinOpeningHours(ksHours, 0, h), `KS Sun hour ${h} should be open`)
}

// 3. Test isOutsideOpeningHours timestamp evaluations
console.log('\n--- 3. Testing isOutsideOpeningHours across timestamps (Europe/Berlin) ---')

// Wednesday 2026-10-07 (CEST = UTC+2)
const wed0645 = new Date('2026-10-07T06:45:00+02:00')
const wed0700 = new Date('2026-10-07T07:00:00+02:00')
const wed1400 = new Date('2026-10-07T14:00:00+02:00')
const wed2259 = new Date('2026-10-07T22:59:00+02:00')
const wed2300 = new Date('2026-10-07T23:00:00+02:00')
const wed2330 = new Date('2026-10-07T23:30:00+02:00')
const thu0200 = new Date('2026-10-08T02:00:00+02:00')

// Freiburg West checks
const resWed0645 = isOutsideOpeningHours(fwHours, wed0645)
assert(resWed0645.isClosed === true, 'FW Wed 06:45 is closed')
assert(resWed0645.stableMinutes > 0, `FW Wed 06:45 stableMinutes: ${resWed0645.stableMinutes}`)

const resWed0700 = isOutsideOpeningHours(fwHours, wed0700)
assert(resWed0700.isClosed === false, 'FW Wed 07:00 is OPEN')

const resWed1400 = isOutsideOpeningHours(fwHours, wed1400)
assert(resWed1400.isClosed === false, 'FW Wed 14:00 is OPEN')

const resWed2259 = isOutsideOpeningHours(fwHours, wed2259)
assert(resWed2259.isClosed === false, 'FW Wed 22:59 is OPEN')

const resWed2300 = isOutsideOpeningHours(fwHours, wed2300)
assert(resWed2300.isClosed === true, 'FW Wed 23:00 is CLOSED')
assert(resWed2300.stableMinutes === 0, `FW Wed 23:00 just closed (stableMinutes: ${resWed2300.stableMinutes})`)

const resWed2330 = isOutsideOpeningHours(fwHours, wed2330)
assert(resWed2330.isClosed === true, 'FW Wed 23:30 is CLOSED')
assert(resWed2330.stableMinutes === 30, `FW Wed 23:30 closed 30 mins ago (stableMinutes: ${resWed2330.stableMinutes})`)

const resThu0200 = isOutsideOpeningHours(fwHours, thu0200)
assert(resThu0200.isClosed === true, 'FW Thu 02:00 is CLOSED')
assert(resThu0200.stableMinutes === 180, `FW Thu 02:00 closed 180 mins ago (stableMinutes: ${resThu0200.stableMinutes})`)

// Sunday checks: 08:00-21:00
const sun0755 = new Date('2026-10-11T07:55:00+02:00')
const sun0800 = new Date('2026-10-11T08:00:00+02:00')
const sun2059 = new Date('2026-10-11T20:59:00+02:00')
const sun2105 = new Date('2026-10-11T21:05:00+02:00')
const mon0630 = new Date('2026-10-12T06:30:00+02:00')

assert(isOutsideOpeningHours(fwHours, sun0755).isClosed === true, 'FW Sun 07:55 is CLOSED')
assert(isOutsideOpeningHours(fwHours, sun0800).isClosed === false, 'FW Sun 08:00 is OPEN')
assert(isOutsideOpeningHours(fwHours, sun2059).isClosed === false, 'FW Sun 20:59 is OPEN')
const resSun2105 = isOutsideOpeningHours(fwHours, sun2105)
assert(resSun2105.isClosed === true, 'FW Sun 21:05 is CLOSED')
assert(resSun2105.stableMinutes === 5, 'FW Sun 21:05 stableMinutes is 5')

const resMon0630 = isOutsideOpeningHours(fwHours, mon0630)
assert(resMon0630.isClosed === true, 'FW Mon 06:30 is CLOSED')
// Closed at 21:00 Sunday -> from 21:00 to 24:00 is 180m, + 390m = 570m
assert(resMon0630.stableMinutes === 570, `FW Mon 06:30 stableMinutes: ${resMon0630.stableMinutes} (closed 9.5 hours)`)

// Karlsruhe Süd checks (24h)
console.log('\n--- 4. Testing Karlsruhe Süd (24h) ---')
assert(isOutsideOpeningHours(ksHours, wed0645).isClosed === false, 'KS Wed 06:45 is OPEN')
assert(isOutsideOpeningHours(ksHours, wed1400).isClosed === false, 'KS Wed 14:00 is OPEN')
assert(isOutsideOpeningHours(ksHours, wed2330).isClosed === false, 'KS Wed 23:30 is OPEN')
assert(isOutsideOpeningHours(ksHours, thu0200).isClosed === false, 'KS Thu 02:00 is OPEN')
assert(isOutsideOpeningHours(ksHours, sun2105).isClosed === false, 'KS Sun 21:05 is OPEN')
assert(isOutsideOpeningHours(ksHours, mon0630).isClosed === false, 'KS Mon 06:30 is OPEN')

console.log('\n🎉 ALL OPENING HOURS & CLOSED DETECTION TESTS PASSED 100%!')
