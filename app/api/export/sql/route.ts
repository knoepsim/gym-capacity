import { PrismaClient } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

const prisma = new PrismaClient()

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
  lines.push('SELECT setval(')
  lines.push("  pg_get_serial_sequence('\\\"Occupancy\\\"', 'id'),")
  lines.push('  COALESCE((SELECT MAX("id") FROM "Occupancy"), 1),')
  lines.push('  (SELECT COUNT(*) > 0 FROM "Occupancy")')
  lines.push(');')
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

    const [gyms, occupancies] = await Promise.all([
      prisma.gym.findMany({ orderBy: { id: 'asc' } }),
      prisma.occupancy.findMany({ orderBy: { id: 'asc' } }),
    ])

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
  } finally {
    await prisma.$disconnect()
  }
}
