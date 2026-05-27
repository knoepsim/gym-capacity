import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function normalizeRating(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const rating = Number(value)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return null
  }

  return rating
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    return null
  }

  return numberValue
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const gymId = typeof body.gymId === 'string' ? body.gymId : ''

    if (!gymId) {
      return NextResponse.json({ error: 'gymId required' }, { status: 400 })
    }

    const created = await prisma.gymFeedback.create({
      data: {
        gymId,
        occupancyCount: normalizeOptionalInteger(body.occupancyCount),
        waitTimeRating: normalizeRating(body.waitTimeRating),
        densityRating: normalizeRating(body.densityRating),
        wouldGoRating: normalizeRating(body.wouldGoRating),
        comment: typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null,
        sourcePath: typeof body.sourcePath === 'string' && body.sourcePath.trim() ? body.sourcePath.trim() : null,
      },
    })

    return NextResponse.json({ success: true, feedbackId: created.id }, { status: 201 })
  } catch (error) {
    console.error('feedback error', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'unknown' }, { status: 500 })
  }
}
