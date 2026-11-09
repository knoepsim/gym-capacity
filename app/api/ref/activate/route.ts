import { randomInt } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logRefEvent } from '@/app/lib/refActivation'
import { REF_ALPHABET, REF_SUFFIX_LENGTH, isRefId } from '@/app/lib/refLink'

function randomSuffix(): string {
  let suffix = ''
  for (let index = 0; index < REF_SUFFIX_LENGTH; index += 1) {
    suffix += REF_ALPHABET[randomInt(REF_ALPHABET.length)]
  }
  return suffix
}

// Called by the browser (not on page render, so link previews in messengers do not use up a device).
// Unknown link or device limit reached: 204 without body, and the browser keeps whatever it had.
export async function POST(request: NextRequest) {
  let body: { ref?: unknown; model?: unknown }
  try {
    body = await request.json()
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  if (!isRefId(body.ref)) return new NextResponse(null, { status: 204 })
  const refId = body.ref

  // Cloudflare overwrites CF-Connecting-IP with the real client address. X-Forwarded-For is only appended to, so its
  // first entry can be faked by the client; it stays as the fallback for setups without Cloudflare
  const ip =
    (
      request.headers.get('cf-connecting-ip') ??
      request.headers.get('x-forwarded-for')?.split(',')[0] ??
      request.headers.get('x-real-ip')
    )
      ?.trim()
      .slice(0, 64) || null
  const userAgent = request.headers.get('user-agent')?.slice(0, 400) || null
  // Client hints from JavaScript first, then the request header (quoted, set after Accept-CH); both need HTTPS
  const bodyModel = typeof body.model === 'string' ? body.model : ''
  const headerModel = request.headers.get('sec-ch-ua-model')?.replace(/^"|"$/g, '') ?? ''
  const deviceModel = (bodyModel.trim() || headerModel.trim()).slice(0, 80) || null

  // Two browsers activating at the same moment can pick the same index; the unique index makes one retry
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const refLink = await prisma.refLink.findUnique({
      where: { id: refId },
      select: { deviceLimit: true, _count: { select: { activations: true } } },
    })
    if (!refLink || refLink._count.activations >= refLink.deviceLimit) {
      return new NextResponse(null, { status: 204 })
    }

    try {
      const activation = await prisma.refActivation.create({
        data: { refId, index: refLink._count.activations + 1, suffix: randomSuffix(), ip, userAgent, deviceModel },
        select: { id: true, suffix: true },
      })
      await logRefEvent(prisma, activation.id, 'activate')
      return NextResponse.json({ token: `${refId}_${activation.suffix}` }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
      console.error('ref activation error', error)
      return new NextResponse(null, { status: 204 })
    }
  }

  return new NextResponse(null, { status: 204 })
}
