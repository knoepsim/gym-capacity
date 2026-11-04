import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { upsertGymSnapshot } from '@/app/lib/gymSnapshot'
import { fetchReading, syncConfigGyms, syncFitxStudios } from '@/app/lib/providers'
import { BASE_INTERVAL_MINUTES, REQUEST_DELAY_MS, intervalMinutesFor, selectDueGyms } from '@/app/lib/polling'

// Snapshots of gyms that were not fetched (failing source, hidden workload) are still refreshed after this
// many intervals, so "today" never keeps showing yesterday's curve. Bounded per run.
const STALE_SNAPSHOT_INTERVALS = 2
const MAX_STALE_REFRESH_PER_RUN = 20

/**
 * POST /api/fetch
 * Wird vom Cron-Service alle BASE_INTERVAL_MINUTES aufgerufen. Abgerufen werden nur die Studios, die laut
 * config/polling.json gerade fällig sind; längere Intervalle werden über mehrere Läufe verteilt.
 */
export async function POST(request: NextRequest) {
  try {
    console.log(`[${new Date().toISOString()}] Fetch API aufgerufen`)

    // Require the configured API key when present in the environment.
    const apiKey = request.headers.get('x-api-key')
    const expectedApiKey = process.env.FETCH_API_KEY

    if (expectedApiKey && apiKey !== expectedApiKey) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    await syncConfigGyms(prisma)
    await syncFitxStudios(prisma)

    const [gyms, lastRows] = await Promise.all([
      prisma.gym.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
      // One index lookup per gym instead of aggregating the whole table
      prisma.$queryRaw<{ gymId: string; max_ts: Date | null }[]>`
        SELECT g."id" AS "gymId",
          (SELECT MAX(o."timestamp") FROM "Occupancy" o WHERE o."gymId" = g."id") AS max_ts
        FROM "Gym" g
        WHERE g."active" = true
      `,
    ])
    const lastByGym = new Map(
      lastRows.filter((row) => row.max_ts !== null).map((row) => [row.gymId, new Date(row.max_ts as Date)])
    )
    const now = Date.now()
    const dueGyms = selectDueGyms(gyms, lastByGym, now)

    let successCount = 0
    let errorCount = 0
    let skippedCount = 0
    const fetchedIds: string[] = []

    for (const [index, gym] of dueGyms.entries()) {
      if (index > 0 && REQUEST_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS))
      }

      try {
        const reading = await fetchReading(gym)

        if (!reading) {
          skippedCount++
          continue
        }

        // Speichere die Auslastungsdaten unverändert (roh)
        await prisma.occupancy.create({
          data: {
            gymId: gym.id,
            count: reading.count,
            maxCount: reading.maxCount,
            timestamp: new Date(),
          },
        })

        fetchedIds.push(gym.id)
        const occupancyPercent = reading.maxCount > 0 ? Math.round((reading.count / reading.maxCount) * 100) : 0
        console.log(`✓ ${gym.name}: ${reading.count}/${reading.maxCount} (${occupancyPercent}%)`)
        successCount++
      } catch (error) {
        console.error(`✗ Fehler bei ${gym.name}:`, error)
        errorCount++
      }
    }

    // Refresh snapshots that are too old although the gym was not fetched (e.g. its source is failing).
    const caches = await prisma.gymAnalyticsCache.findMany({ select: { gymId: true, computedAt: true } })
    const computedAtByGym = new Map(caches.map((cache) => [cache.gymId, cache.computedAt.getTime()]))
    const fetchedSet = new Set(fetchedIds)
    const staleIds = gyms
      .filter((gym) => !fetchedSet.has(gym.id) && lastByGym.has(gym.id))
      .filter((gym) => {
        const computedAt = computedAtByGym.get(gym.id)
        return computedAt === undefined || now - computedAt > intervalMinutesFor(gym.region) * STALE_SNAPSHOT_INTERVALS * 60000
      })
      .slice(0, MAX_STALE_REFRESH_PER_RUN)
      .map((gym) => gym.id)

    // Cache the derived snapshots so page requests only read cached data.
    for (const gymId of [...fetchedIds, ...staleIds]) {
      try {
        await upsertGymSnapshot(prisma, gymId)
      } catch (error) {
        console.error(`✗ Snapshot für ${gymId} fehlgeschlagen:`, error)
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: `Datenabruf abgeschlossen: ${successCount} erfolgreich, ${errorCount} Fehler, ${skippedCount} ohne Wert`,
        timestamp: new Date(),
        stats: {
          success: successCount,
          failed: errorCount,
          skipped: skippedCount,
          due: dueGyms.length,
          staleSnapshotsRefreshed: staleIds.length,
          total: gyms.length,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Fataler Fehler:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/fetch
 * Health check / Info endpoint
 */
export async function GET() {
  const gyms = await prisma.gym.findMany({
    where: { active: true },
    select: { id: true, name: true, provider: true, region: true },
    orderBy: { id: 'asc' },
  })

  return NextResponse.json({
    message: 'Gym Capacity Fetcher API',
    endpoint: 'POST /api/fetch',
    auth: process.env.FETCH_API_KEY ? 'Required: x-api-key Header' : 'Optional: x-api-key Header',
    baseIntervalMinutes: BASE_INTERVAL_MINUTES,
    stats: {
      gyms: gyms.length,
      gyms_list: gyms,
    },
    timestamp: new Date()
  })
}
