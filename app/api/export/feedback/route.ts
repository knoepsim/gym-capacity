import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  const stringValue = value instanceof Date ? value.toISOString() : String(value)
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return '"' + stringValue.replace(/"/g, '""') + '"'
  }

  return stringValue
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

    const where: {
      createdAt?: { gte: Date }
    } = {}

    if (sinceDate && !Number.isNaN(sinceDate.getTime())) {
      where.createdAt = { gte: sinceDate }
    }

    const feedbackEntries = await prisma.gymFeedback.findMany({
      where,
      include: {
        gym: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { id: 'asc' },
      ...(limit ? { take: limit } : {}),
    })

    const header = [
      'id',
      'gymId',
      'gymName',
      'occupancyCount',
      'waitTimeRating',
      'densityRating',
      'wouldGoRating',
      'comment',
      'sourcePath',
      'createdAt',
    ]

    const lines = [header.join(',')]

    for (const entry of feedbackEntries) {
      lines.push(
        [
          csvEscape(entry.id),
          csvEscape(entry.gymId),
          csvEscape(entry.gym.name),
          csvEscape(entry.occupancyCount),
          csvEscape(entry.waitTimeRating),
          csvEscape(entry.densityRating),
          csvEscape(entry.wouldGoRating),
          csvEscape(entry.comment),
          csvEscape(entry.sourcePath),
          csvEscape(entry.createdAt),
        ].join(',')
      )
    }

    const filename = `gym-capacity-feedback-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`

    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Feedback export failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}