'use server'

import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isAdminAuthorization } from '@/lib/adminAuth'
import { REF_ALPHABET, REF_LENGTH, isRefId } from '@/app/lib/refLink'

export type RefLinkActionResult = { ok: true } | { ok: false; error: string }

// Server actions can be called directly, so they check the login themselves instead of relying on the middleware
async function assertAdmin() {
  const requestHeaders = await headers()
  if (!isAdminAuthorization(requestHeaders.get('authorization'))) {
    throw new Error('Nicht angemeldet')
  }
}

function generateRefId(): string {
  let id = ''
  for (let index = 0; index < REF_LENGTH; index += 1) {
    id += REF_ALPHABET[randomInt(REF_ALPHABET.length)]
  }
  return id
}

function validateName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Bitte einen Namen eingeben.'
  if (trimmed.length > 80) return 'Der Name darf höchstens 80 Zeichen lang sein.'
  return null
}

function normalizeNote(note: string): string | null {
  const trimmed = note.trim().slice(0, 1000)
  return trimmed === '' ? null : trimmed
}

export async function createRefLink(name: string, note: string): Promise<RefLinkActionResult> {
  await assertAdmin()

  const nameError = validateName(name)
  if (nameError) return { ok: false, error: nameError }

  // 61^6 ids make a clash very unlikely; retry a few times anyway
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await prisma.refLink.create({ data: { id: generateRefId(), name: name.trim(), note: normalizeNote(note) } })
      revalidatePath('/admin')
      return { ok: true }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
      throw error
    }
  }

  return { ok: false, error: 'Konnte keinen freien Code erzeugen. Bitte nochmal versuchen.' }
}

export async function updateRefLink(id: string, name: string, note: string): Promise<RefLinkActionResult> {
  await assertAdmin()

  if (!isRefId(id)) return { ok: false, error: 'Ungültiger Code.' }
  const nameError = validateName(name)
  if (nameError) return { ok: false, error: nameError }

  await prisma.refLink.update({ where: { id }, data: { name: name.trim(), note: normalizeNote(note) } })
  revalidatePath('/admin')
  return { ok: true }
}

// More browsers for this link, e.g. after a new phone or cleared browser data
export async function increaseDeviceLimit(id: string): Promise<RefLinkActionResult> {
  await assertAdmin()

  if (!isRefId(id)) return { ok: false, error: 'Ungültiger Code.' }
  await prisma.refLink.update({ where: { id }, data: { deviceLimit: { increment: 1 } } })
  revalidatePath('/admin')
  return { ok: true }
}

// Soft delete: the device stays in the list (and keeps using up a slot), but its token stops counting
export async function setDeviceRevoked(activationId: number, revoked: boolean): Promise<RefLinkActionResult> {
  await assertAdmin()

  if (!Number.isInteger(activationId)) return { ok: false, error: 'Ungültiges Gerät.' }
  await prisma.refActivation.update({ where: { id: activationId }, data: { revokedAt: revoked ? new Date() : null } })
  revalidatePath('/admin')
  return { ok: true }
}

// Never below the devices already activated (and at least 1)
export async function decreaseDeviceLimit(id: string): Promise<RefLinkActionResult> {
  await assertAdmin()

  if (!isRefId(id)) return { ok: false, error: 'Ungültiger Code.' }
  const used = await prisma.refActivation.count({ where: { refId: id } })
  const floor = Math.max(used, 1)
  const { count } = await prisma.refLink.updateMany({ where: { id, deviceLimit: { gt: floor } }, data: { deviceLimit: { decrement: 1 } } })
  if (count === 0) return { ok: false, error: `Das Limit kann nicht unter ${floor} sinken (so viele Geräte sind aktiviert).` }
  revalidatePath('/admin')
  return { ok: true }
}

// Reports keep their content; they just lose the link to the deleted ref
export async function deleteRefLink(id: string): Promise<RefLinkActionResult> {
  await assertAdmin()

  if (!isRefId(id)) return { ok: false, error: 'Ungültiger Code.' }
  await prisma.refLink.delete({ where: { id } })
  revalidatePath('/admin')
  return { ok: true }
}
