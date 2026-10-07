function simulateForecastSeries(currentHourBerlin, isOpenFn) {
  // Simulates the exact logic from buildTodayForecastSeries
  return Array.from({ length: 24 }, (_, hour) => {
    const actual = hour <= currentHourBerlin ? 50 : null
    const isOpenThisHour = isOpenFn(hour)
    let forecast = null

    if (hour < currentHourBerlin) {
      forecast = null
    } else if (!isOpenThisHour) {
      forecast = 0
    } else if (hour === currentHourBerlin) {
      forecast = 50
    } else {
      forecast = 40
    }

    return {
      hour,
      actual_count: hour > currentHourBerlin ? null : (!isOpenThisHour ? (actual !== null ? 0 : null) : actual),
      forecast_count: forecast,
    }
  })
}

function sanitizeChartData(data, currentBerlinHour) {
  return data.map((d) => ({
    ...d,
    actual_count: d.hour > currentBerlinHour ? null : d.actual_count,
    forecast_count: d.hour < currentBerlinHour ? null : d.forecast_count,
  }))
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`)
    process.exit(1)
  }
  console.log(`✓ ${message}`)
}

console.log('========================================================')
console.log('TESTING FUTURE-ONLY FORECAST LOGIC')
console.log('========================================================\n')

// Test 1: Current hour is 22:00 (like in the user screenshot)
// Gym open 07:00-23:00 (hours 7..22 open, 23 closed)
const isOpenFW = (h) => h >= 7 && h <= 22
const seriesAt22 = simulateForecastSeries(22, isOpenFW)

console.log('--- Test 1: Current hour = 22:00 ---')
// Past hours 0..21: forecast_count MUST be null
for (let h = 0; h < 22; h++) {
  assert(seriesAt22[h].forecast_count === null, `Hour ${h} forecast MUST be null (past hour)`)
  if (h >= 7) {
    assert(seriesAt22[h].actual_count === 50, `Hour ${h} actual should be 50`)
  } else {
    assert(seriesAt22[h].actual_count === 0, `Hour ${h} actual should be 0 (closed)`)
  }
}
// Current hour 22: forecast is 50
assert(seriesAt22[22].forecast_count === 50, 'Hour 22 forecast is 50')
// Hour 23 (closed): forecast is 0, actual is null
assert(seriesAt22[23].forecast_count === 0, 'Hour 23 forecast is 0 (closed)')
assert(seriesAt22[23].actual_count === null, 'Hour 23 actual is null (future hour)')

// Test 2: Current hour is 14:00 (midday)
console.log('\n--- Test 2: Current hour = 14:00 ---')
const seriesAt14 = simulateForecastSeries(14, isOpenFW)
for (let h = 0; h < 14; h++) {
  assert(seriesAt14[h].forecast_count === null, `Hour ${h} forecast MUST be null (past hour)`)
}
assert(seriesAt14[14].forecast_count === 50, 'Hour 14 forecast is present')
for (let h = 15; h <= 22; h++) {
  assert(seriesAt14[h].forecast_count === 40, `Hour ${h} forecast is 40`)
  assert(seriesAt14[h].actual_count === null, `Hour ${h} actual MUST be null (future hour)`)
}

// Test 3: Chart sanitization against stale cache
console.log('\n--- Test 3: Chart Sanitization on Client ---')
// Simulate stale cache created at 10:00, but user views at 18:00
const staleData = simulateForecastSeries(10, isOpenFW)
const cleanedAt18 = sanitizeChartData(staleData, 18)

for (let h = 0; h < 18; h++) {
  assert(cleanedAt18[h].forecast_count === null, `Cleaned Hour ${h} forecast MUST be null at 18:00`)
}
assert(cleanedAt18[18].forecast_count !== null, 'Cleaned Hour 18 forecast is available')
for (let h = 19; h < 24; h++) {
  assert(cleanedAt18[h].actual_count === null, `Cleaned Hour ${h} actual MUST be null at 18:00`)
}

console.log('\n🎉 ALL FUTURE-ONLY FORECAST TESTS PASSED!')
