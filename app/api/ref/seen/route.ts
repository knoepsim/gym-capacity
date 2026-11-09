import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findRefActivation, logRefEvent } from '@/app/lib/refActivation'

// Called once per browser session by RefTracker: marks the device as seen. Always 204, so a revoked or unknown
// token learns nothing from the answer.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { token?: unknown }
    const activation = await findRefActivation(prisma, body.token)
    if (activation) await logRefEvent(prisma, activation.id, 'visit')
  } catch {
    // Malformed body: nothing to record
  }
  return new NextResponse(null, { status: 204 })
}
