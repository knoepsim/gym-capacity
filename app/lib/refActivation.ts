import type { PrismaClient } from '@prisma/client'
import { parseRefToken } from '@/app/lib/refLink'

export type RefEventType = 'activate' | 'visit' | 'report'

/** Server side: the activation behind a device token, or null when the token is unknown, malformed or revoked. */
export async function findRefActivation(prisma: PrismaClient, token: unknown) {
  const parsed = parseRefToken(token)
  if (!parsed) return null

  return prisma.refActivation.findFirst({
    where: { refId: parsed.refId, suffix: parsed.suffix, revokedAt: null },
    select: { id: true, refId: true, index: true, ref: { select: { name: true } } },
  })
}

/**
 * Records an access of a device with its IP. Failures never break the request. A 'visit' is skipped when the
 * device was seen in the last few minutes from the same IP, so page loads do not flood the table.
 */
export async function logRefEvent(prisma: PrismaClient, activationId: number, type: RefEventType, ip: string | null) {
  try {
    if (type === 'visit') {
      const recent = await prisma.refEvent.findFirst({
        where: { activationId, ip, createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) } },
        select: { id: true },
      })
      if (recent) return
    }
    await prisma.refEvent.create({ data: { activationId, type, ip } })
  } catch (error) {
    console.error('ref event error', error)
  }
}
