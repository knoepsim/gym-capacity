import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import gyms from '@/config/gyms.json'
import { buildStableAggregatedData, buildTodayForecastSeries } from '@/app/lib/forecasting'

const prisma = new PrismaClient()

async function writeJSON(gymId: string, obj: unknown) {
  const dir = path.join(process.cwd(), 'data', 'aggregates')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${gymId}.json`)
  fs.writeFileSync(file, JSON.stringify(obj, null, 2))
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key')
    if (process.env.REFRESH_API_KEY && apiKey !== process.env.REFRESH_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = request.nextUrl
    const gymIdParam = url.searchParams.get('gymId')
    const lookbackParam = url.searchParams.get('lookbackDays')
    const lookbackDays = lookbackParam ? Number(lookbackParam) : 56

    const targetGyms = gymIdParam ? (gyms as any[]).filter((g) => g.id === gymIdParam) : (gyms as any[])

    const results: any[] = []
    for (const g of targetGyms) {
      try {
        const agg = await buildStableAggregatedData(prisma, g.id, lookbackDays)
        const today = await buildTodayForecastSeries(prisma, g.id)
        const out = { gymId: g.id, aggregated: agg, today }
        await writeJSON(g.id, out)
        results.push({ gym: g.id, success: true })
      } catch (e) {
        console.error('refresh error for', g.id, e)
        results.push({ gym: g.id, success: false, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json({ success: true, results }, { status: 200 })
  } catch (error) {
    console.error('refresh fatal', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'unknown' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const gymId = url.searchParams.get('gymId')
  if (!gymId) return NextResponse.json({ error: 'gymId required' }, { status: 400 })
  const file = path.join(process.cwd(), 'data', 'aggregates', `${gymId}.json`)
  if (!fs.existsSync(file)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const content = fs.readFileSync(file, 'utf8')
  return new NextResponse(content, { headers: { 'Content-Type': 'application/json' } })
}
