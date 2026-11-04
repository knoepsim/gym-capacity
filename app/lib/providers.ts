import type { PrismaClient } from '@prisma/client'
import configGyms from '@/config/gyms.json'

// Upstream occupancy sources. Readings are stored exactly as reported (raw), corrections happen at read time.

export type Provider = 'clubconnector' | 'fitx'

export interface Reading {
  count: number
  maxCount: number
}

interface PollableGym {
  provider: string
  url: string
}

const USER_AGENT = 'GymCapacityMonitor/1.0'
const REQUEST_TIMEOUT_MS = 10_000

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  // FitX answers JSON with a text/html content type, so parse the body ourselves.
  return JSON.parse(await response.text())
}

/** Returns null when the source currently publishes no value (e.g. FitX hides the workload). */
export async function fetchReading(gym: PollableGym): Promise<Reading | null> {
  const data = await getJson(gym.url)

  if (gym.provider === 'fitx') {
    // Array of JSON strings: the requested studio first, nearby studios after it.
    if (!Array.isArray(data) || typeof data[0] !== 'string') {
      throw new Error('Invalid FitX response')
    }

    const studio = JSON.parse(data[0]) as { hideWorkload?: boolean; workload?: { percentage?: unknown } | null }
    const percentage = studio.workload?.percentage
    if (studio.hideWorkload || typeof percentage !== 'number') {
      return null
    }

    return { count: Math.round(percentage), maxCount: 100 }
  }

  const reading = data as { count?: unknown; maxCount?: unknown }
  if (typeof reading.count !== 'number' || typeof reading.maxCount !== 'number') {
    throw new Error(`Invalid data format: ${JSON.stringify(data)}`)
  }

  return { count: reading.count, maxCount: reading.maxCount }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Makes sure every gym from config/gyms.json exists with its current name and location. */
export async function syncConfigGyms(prisma: PrismaClient): Promise<void> {
  for (const gym of configGyms) {
    // Keyed by URL: renaming an ID is the seed's job (it keeps the history attached).
    const fields = { name: gym.name, region: gym.region, city: gym.city, provider: 'clubconnector', unit: 'persons' }
    await prisma.gym.upsert({
      where: { url: gym.url },
      update: fields,
      create: { id: gym.id, url: gym.url, ...fields },
    })
  }
}

// --- FitX studio discovery -------------------------------------------------------------------------

const FITX_SEARCH_URL = 'https://www.fitx.de/fitnessstudios/api/search'
const FITX_PAGE_SIZE = 100
const FITX_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000
const FITX_RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000
const FITX_STATUS_OPEN = 2

interface FitxStudio {
  name: string
  branchId: number
  addressPlace?: string
  addressRegion?: string
  status?: number
}

let nextFitxSync = 0

export function fitxWorkloadUrl(branchId: number): string {
  return `https://www.fitx.de/fitnessstudio/${branchId}/workload`
}

async function loadFitxStudios(): Promise<FitxStudio[]> {
  const studios: FitxStudio[] = []

  for (let page = 0; page < 20; page += 1) {
    const data = await getJson(`${FITX_SEARCH_URL}?skip=${page * FITX_PAGE_SIZE}&limit=${FITX_PAGE_SIZE}`)
    if (!Array.isArray(data)) {
      throw new Error('Invalid FitX search response')
    }

    studios.push(...(data as FitxStudio[]).filter((studio) => typeof studio.branchId === 'number' && typeof studio.name === 'string'))
    if (data.length < FITX_PAGE_SIZE) break
  }

  return studios
}

/**
 * Mirrors the FitX studio list into the Gym table at most once a day. The workload URL (branch ID) is the
 * stable key, so a renamed studio keeps its ID and history. Studios that are not open are kept but not polled.
 */
export async function syncFitxStudios(prisma: PrismaClient): Promise<void> {
  if (Date.now() < nextFitxSync) return

  try {
    const studios = await loadFitxStudios()
    if (studios.length === 0) {
      throw new Error('FitX search returned no studios')
    }

    for (const studio of studios) {
      const url = fitxWorkloadUrl(studio.branchId)
      const fields = {
        name: `FitX ${studio.name}`,
        provider: 'fitx',
        unit: 'percent',
        region: studio.addressRegion ?? null,
        city: studio.addressPlace ?? null,
        active: studio.status === FITX_STATUS_OPEN,
      }

      await prisma.gym.upsert({
        where: { url },
        update: fields,
        create: { id: slugify(fields.name), url, ...fields },
      })
    }

    await prisma.gym.updateMany({
      where: { provider: 'fitx', url: { notIn: studios.map((studio) => fitxWorkloadUrl(studio.branchId)) } },
      data: { active: false },
    })

    nextFitxSync = Date.now() + FITX_SYNC_INTERVAL_MS
    console.log(`✓ FitX: ${studios.length} Studios synchronisiert`)
  } catch (error) {
    nextFitxSync = Date.now() + FITX_RETRY_AFTER_FAILURE_MS
    console.error('✗ FitX-Studioliste konnte nicht geladen werden:', error)
  }
}
