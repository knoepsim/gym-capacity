// Simple ARIMA prototype using node-arima (install dependency)
const { PrismaClient } = require('@prisma/client')
const Arima = require('arima')

const prisma = new PrismaClient()

async function run(gymId, lookbackDays = 56, steps = 6) {
  // build hourly series for the lookback period
  const rows = await prisma.$queryRaw`
    SELECT ( ("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin') as local_ts, EXTRACT(HOUR FROM ( ("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')) as hour, count
    FROM "Occupancy"
    WHERE "gymId" = ${gymId} AND "timestamp" >= NOW() - (${lookbackDays} * INTERVAL '1 day')
    ORDER BY local_ts ASC
  `

  // aggregate to hourly mean
  const hourMap = new Map()
  for (const r of rows) {
    const key = new Date(r.local_ts).toISOString().slice(0,13) // YYYY-MM-DDTHH
    const arr = hourMap.get(key) ?? []
    arr.push(Number(r.count))
    hourMap.set(key, arr)
  }
  const series = []
  for (const [k, arr] of hourMap.entries()) {
    series.push(arr.reduce((a,b)=>a+b,0)/arr.length)
  }

  // fit ARIMA
  const arima = new Arima({ p: 2, d: 0, q: 2, verbose: false }).train(series)
  const [pred, errors] = arima.predict(steps)
  console.log('Forecast:', pred)
  await prisma.$disconnect()
}

if (require.main === module) {
  const gymId = process.argv[2]
  if (!gymId) { console.error('Usage: node scripts/arima_prototype.js <gymId>'); process.exit(1) }
  run(gymId).catch((e)=>{ console.error(e); process.exit(1) })
}
