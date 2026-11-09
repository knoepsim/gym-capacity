import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findRefActivation } from '@/app/lib/refActivation'

// Public lookup for the footer: public code and display name for a device token, never the internal note.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const activation = await findRefActivation(prisma, token)
  if (!activation) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  return NextResponse.json(
    { code: activation.refId, name: activation.ref.name },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
