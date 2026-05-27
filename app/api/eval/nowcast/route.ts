import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { fetchHistory, buildProfiles, resolveProfileValue, inferOpeningHoursFromBuckets } from '@/app/lib/forecasting'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl
    const gymId = url.searchParams.get('gymId')
    const daysParam = url.searchParams.get('days')
    const lookbackDays = daysParam ? Number(daysParam) : 30

    if (!gymId) return NextResponse.json({ error: 'gymId required' }, { status: 400 })

    const rows = await fetchHistory(prisma, gymId, lookbackDays)
    const { weekdayHourProfile, hourProfile, overallProfile, maxCapacity, dayBuckets } = buildProfiles(rows)

    const dayKeys = Array.from(dayBuckets.keys())
    const errorsBaseline: number[] = []
    const errorsNowcast: number[] = []
    const naiveDiffs: number[] = []

    for (const dayKey of dayKeys) {
      // build profiles excluding this day
      const otherRows = rows.filter((r) => r.local_day !== dayKey)
      const { weekdayHourProfile: wp2, hourProfile: hp2, overallProfile: op2, dayBuckets: db2 } = buildProfiles(otherRows)

      const bucket = dayBuckets.get(dayKey)
      if (!bucket) continue
      for (let h = 0; h < 24; h++) {
        const vals = bucket.hourlyValues.get(h) ?? []
        const actual = mean(vals.map((v) => Number(v)))
        if (actual === null) continue

        const baseline = resolveProfileValue(wp2 as any, hp2 as any, op2 as any, bucket.weekday, h, inferOpeningHoursFromBuckets(db2))

        // simple nowcast: use previous two hourly means within same day to project
        const prev1 = mean(bucket.hourlyValues.get(h - 1) ?? [])
        const prev2 = mean(bucket.hourlyValues.get(h - 2) ?? [])
        let nowcast = baseline
        if (prev1 !== null && prev2 !== null) {
          const delta = prev1 - prev2
          nowcast = baseline + delta * 0.5
        } else if (prev1 !== null) {
          nowcast = baseline * 0.6 + prev1 * 0.4
        }

        errorsBaseline.push(Math.abs(baseline - actual))
        errorsNowcast.push(Math.abs(nowcast - actual))

        // naive diff for MASE denominator (adjacent hour change)
        const prev = prev1 ?? baseline
        naiveDiffs.push(Math.abs(actual - prev))
      }
    }

    const mae = (arr: number[]) => (arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length)
    const maeBaseline = mae(errorsBaseline)
    const maeNowcast = mae(errorsNowcast)
    const denom = mae(naiveDiffs) || 1
    const maseBaseline = maeBaseline !== null ? maeBaseline / denom : null
    const maseNowcast = maeNowcast !== null ? maeNowcast / denom : null

    return NextResponse.json({ gymId, lookbackDays, maeBaseline, maeNowcast, maseBaseline, maseNowcast })
  } catch (error) {
    console.error('eval error', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'unknown' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

function mean(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length === 0) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}
