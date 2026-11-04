import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/status – latest reading per gym, used by the clients' auto refresh.
 * Reads the snapshot cache (one row per gym) instead of aggregating the raw occupancy table, and may be
 * cached briefly because new readings arrive at most every few minutes.
 */
export async function GET() {
  try {
    const rows = await prisma.gymAnalyticsCache.findMany({
      where: { gym: { active: true } },
      select: { gymId: true, sourceLatestTimestamp: true },
    })

    const result: Record<string, string | null> = {}
    for (const row of rows) {
      result[row.gymId] = row.sourceLatestTimestamp ? row.sourceLatestTimestamp.toISOString() : null
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=30' } })
  } catch (e) {
    console.error('status error', e)
    return NextResponse.json({}, { status: 500 })
  }
}
