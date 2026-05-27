import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const gymId = request.nextUrl.searchParams.get('gymId')

    if (!gymId) {
      return NextResponse.json({ error: 'gymId required' }, { status: 400 })
    }

    const latest = await prisma.occupancy.findFirst({
      where: { gymId },
      orderBy: { timestamp: 'desc' },
      select: {
        count: true,
        maxCount: true,
        timestamp: true,
      },
    })

    if (!latest) {
      return NextResponse.json({ gymId, latest: null })
    }

    return NextResponse.json({
      gymId,
      latest: {
        count: latest.count,
        maxCount: latest.maxCount,
        timestamp: latest.timestamp.toISOString(),
      },
    })
  } catch (error) {
    console.error('latest occupancy error', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'unknown' }, { status: 500 })
  }
}
