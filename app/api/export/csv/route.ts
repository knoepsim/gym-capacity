import { PrismaClient } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

const prisma = new PrismaClient()

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'string' ? value : String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export async function GET(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key')
    const expectedApiKey = process.env.EXPORT_API_KEY || process.env.FETCH_API_KEY

    if (expectedApiKey && apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const params = request.nextUrl?.searchParams
    const sinceParam = params?.get('since')
    const limitParam = params?.get('limit')

    const sinceDate = sinceParam ? new Date(sinceParam) : null
    const limit = limitParam ? Number(limitParam) : undefined

    const where: any = {}
    if (sinceDate && !isNaN(sinceDate.getTime())) {
      where.timestamp = { gte: sinceDate }
    }

    const rows = await prisma.occupancy.findMany({
      where,
      orderBy: { id: 'asc' },
      ...(limit ? { take: limit } : {}),
    })

    // CSV header
    const header = ['id', 'gymId', 'count', 'maxCount', 'timestamp']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([
        csvEscape(r.id),
        csvEscape(r.gymId),
        csvEscape(r.count),
        csvEscape(r.maxCount),
        csvEscape(r.timestamp?.toISOString()),
      ].join(','))
    }

    const filename = `gym-capacity-occupancy-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
    const body = lines.join('\n')
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('CSV export failed:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
