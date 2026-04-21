import { PrismaClient } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

const prisma = new PrismaClient()

/**
 * Fitness-Studios die wir abfragen
 */
const GYMS = [
  {
    id: 'karlsruhe-sued',
    name: 'Sportprinz Karlsruhe Süd',
    url: 'https://clubconnector.sovd.cloud/api/anwesende/47fc873e-1bc1-431a-9111-e66d5abefa67-070367/22'
  },
  {
    id: 'freiburg-west',
    name: 'Sportprinz Freiburg West',
    url: 'https://clubconnector.sovd.cloud/api/anwesende/47fc873e-1bc1-431a-9111-e66d5abefa67-070367/16'
  }
]

/**
 * POST /api/fetch
 * Externe Services oder Cron-Jobs können diese Route aufrufen
 * um aktuelle Auslastungsdaten abzurufen
 */
export async function POST(request: NextRequest) {
  try {
    console.log(`[${new Date().toISOString()}] Fetch API aufgerufen`)

    // Optional: Authentifizierung prüfen (z.B. mit API Key)
    const apiKey = request.headers.get('x-api-key')
    if (apiKey && apiKey !== process.env.FETCH_API_KEY) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    let successCount = 0
    let errorCount = 0

    // Für jedes Studio: Daten abrufen und speichern
    for (const gym of GYMS) {
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
          total: GYMS.length
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
  } finally {
    await prisma.$disconnect()
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
    auth: 'Optional: x-api-key Header',
    stats: {
      gyms: GYMS.length,
      gyms_list: GYMS.map(g => ({ id: g.id, name: g.name }))
    },
    timestamp: new Date()
  })
}
