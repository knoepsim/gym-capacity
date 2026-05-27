import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const rows = await prisma.$queryRaw<{ gymId: string; max_ts: Date }[]>`
      SELECT "gymId", MAX("timestamp") as max_ts FROM "Occupancy" GROUP BY "gymId"
    `
    const result: Record<string, string | null> = {}
    for (const r of rows) {
      result[r.gymId] = r.max_ts ? new Date(r.max_ts).toISOString() : null
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('status error', e)
    return NextResponse.json({}, { status: 500 })
  }
}
