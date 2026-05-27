import { NextRequest, NextResponse } from 'next/server'
import gyms from '@/config/gyms.json'
import { prisma } from '@/lib/prisma'
import { upsertGymSnapshot } from '@/app/lib/gymSnapshot'

/**
 * POST /api/fetch
 * Externe Services oder Cron-Jobs können diese Route aufrufen
 * um aktuelle Auslastungsdaten abzurufen
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

    let successCount = 0
    let errorCount = 0

    // Für jedes Studio: Daten abrufen und speichern
    for (const gym of gyms) {
      try {
        const response = await fetch(gym.url, {
          method: 'GET',
          headers: { 'User-Agent': 'GymCapacityMonitor/1.0' }
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()

        // Validiere die Antwort
        if (typeof data.count !== 'number' || typeof data.maxCount !== 'number') {
          throw new Error(`Invalid data format: ${JSON.stringify(data)}`)
        }

        // Stelle sicher, dass das Studio in der DB existiert
        await prisma.gym.upsert({
          where: { id: gym.id },
          update: {},
          create: { id: gym.id, name: gym.name, url: gym.url }
        })

        // Speichere die Auslastungsdaten
        await prisma.occupancy.create({
          data: {
            gymId: gym.id,
            count: data.count,
            maxCount: data.maxCount,
            timestamp: new Date()
          }
        })

        // Cache the derived snapshot once per fetch cycle so page requests only read cached data.
        await upsertGymSnapshot(prisma, gym.id)

        const occupancyPercent = Math.round((data.count / data.maxCount) * 100)
        console.log(`✓ ${gym.name}: ${data.count}/${data.maxCount} (${occupancyPercent}%)`)
        successCount++
      } catch (error) {
        console.error(`✗ Fehler bei ${gym.name}:`, error)
        errorCount++
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: `Datenabruf abgeschlossen: ${successCount} erfolgreich, ${errorCount} Fehler`,
        timestamp: new Date(),
        stats: {
          success: successCount,
          failed: errorCount,
          total: gyms.length
        }
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
  return NextResponse.json({
    message: 'Gym Capacity Fetcher API',
    endpoint: 'POST /api/fetch',
      auth: process.env.FETCH_API_KEY ? 'Required: x-api-key Header' : 'Optional: x-api-key Header',
    stats: {
      gyms: gyms.length,
      gyms_list: gyms.map(g => ({ id: g.id, name: g.name }))
    },
    timestamp: new Date()
  })
}
