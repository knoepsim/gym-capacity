import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }

  if (typeof value === 'string') {
    return `'${escapeSqlString(value)}'`
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }

  return String(value)
}

function buildSqlDump(
  gyms: Array<{ id: string; name: string; url: string; createdAt: Date; updatedAt: Date }>,
  occupancies: Array<{ id: number; gymId: string; count: number; maxCount: number; timestamp: Date }>
): string {
  const lines: string[] = []

  lines.push('-- gym-capacity SQL export')
  lines.push(`-- generated_at_utc: ${new Date().toISOString()}`)
  lines.push('BEGIN;')
  lines.push('')
  lines.push('-- Clear target tables before import')
  lines.push('TRUNCATE TABLE "Occupancy", "Gym" RESTART IDENTITY CASCADE;')
  lines.push('')

  if (gyms.length > 0) {
    lines.push('-- Reinsert Gym rows')
    lines.push('INSERT INTO "Gym" ("id", "name", "url", "createdAt", "updatedAt") VALUES')
    lines.push(
      gyms
        .map((gym) => {
          return `  (${sqlValue(gym.id)}, ${sqlValue(gym.name)}, ${sqlValue(gym.url)}, ${sqlValue(gym.createdAt)}, ${sqlValue(gym.updatedAt)})`
        })
        .join(',\n') + ';'
    )
    lines.push('')
  }

  if (occupancies.length > 0) {
    lines.push('-- Reinsert Occupancy rows')
    lines.push('INSERT INTO "Occupancy" ("id", "gymId", "count", "maxCount", "timestamp") VALUES')
    lines.push(
      occupancies
        .map((row) => {
          return `  (${sqlValue(row.id)}, ${sqlValue(row.gymId)}, ${sqlValue(row.count)}, ${sqlValue(row.maxCount)}, ${sqlValue(row.timestamp)})`
        })
        .join(',\n') + ';'
    )
    lines.push('')
  }

  lines.push('-- Keep autoincrement sequence in sync with imported IDs')
  lines.push(
    "SELECT setval(pg_get_serial_sequence('\"Occupancy\"','id'), COALESCE((SELECT MAX(\"id\") FROM \"Occupancy\"), 1), (SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END FROM \"Occupancy\"));"
  )
  lines.push('')
  lines.push('COMMIT;')

  return lines.join('\n')
}

export async function GET(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key')
    const expectedApiKey = process.env.EXPORT_API_KEY || process.env.FETCH_API_KEY

    if (expectedApiKey && apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Support query params: ?since=2026-04-01T00:00:00Z&limit=10000
    const params = request.nextUrl?.searchParams
    const sinceParam = params?.get('since')
    const limitParam = params?.get('limit')

    const sinceDate = sinceParam ? new Date(sinceParam) : null
    const limit = limitParam ? Number(limitParam) : undefined

    const gymsPromise = prisma.gym.findMany({ orderBy: { id: 'asc' } })
    const occupancyWhere: any = {}
    if (sinceDate && !isNaN(sinceDate.getTime())) {
      occupancyWhere.timestamp = { gte: sinceDate }
    }
    const occupanciesPromise = prisma.occupancy.findMany({
      where: occupancyWhere,
      orderBy: { id: 'asc' },
      ...(limit ? { take: limit } : {}),
    })

    const [gyms, occupancies] = await Promise.all([gymsPromise, occupanciesPromise])

    const sqlDump = buildSqlDump(gyms, occupancies)
    const filename = `gym-capacity-export-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`

    return new NextResponse(sqlDump, {
      status: 200,
      headers: {
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('DB export failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
