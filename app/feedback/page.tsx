export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FeedbackGymGrid } from './FeedbackGymGrid'

async function getFeedbackEntries() {
  try {
    return await prisma.gymFeedback.findMany({
      include: {
        gym: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { gymId: 'asc' },
        { createdAt: 'desc' },
      ],
    })
  } catch (error) {
    console.error('Fehler beim Abrufen des Feedbacks:', error)
    return []
  }
}

function formatRating(value: number | null) {
  return value ?? '—'
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

export default async function FeedbackPage() {
  const entries = await getFeedbackEntries()

  const grouped = entries.reduce<Record<string, typeof entries>>((accumulator, entry) => {
    ;(accumulator[entry.gymId] ||= []).push(entry)
    return accumulator
  }, {})

  const gymIds = Object.keys(grouped).sort((left, right) => {
    const leftName = grouped[left]?.[0]?.gym.name ?? left
    const rightName = grouped[right]?.[0]?.gym.name ?? right
    return leftName.localeCompare(rightName, 'de')
  })

  const totalFeedback = entries.length

  return (
    <main className="min-h-screen">
      <div className="border-b border-border/70 bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Feedback-Übersicht</h1>
            <p className="max-w-2xl text-muted-foreground">
              Alle eingegangenen Rückmeldungen, gruppiert pro Studio.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{totalFeedback} Feedback-Einträge insgesamt</p>
            <Button asChild variant="outline">
              <Link href="/">Zur Übersicht</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {totalFeedback === 0 ? (
          <Card className="border-border/70 bg-card/90">
            <CardHeader>
              <CardTitle>Noch kein Feedback vorhanden</CardTitle>
              <CardDescription>Sobald Rückmeldungen eingehen, erscheinen sie hier pro Studio.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-8">
            {gymIds.map((gymId) => {
              const gymEntries = grouped[gymId] ?? []
              const gymName = gymEntries[0]?.gym.name ?? gymId

              return (
                <Card key={gymId} className="border-border/70 bg-card/90">
                  <CardHeader>
                    <CardTitle className="text-2xl">{gymName}</CardTitle>
                    <CardDescription>
                      {gymEntries.length} Eintrag{gymEntries.length === 1 ? '' : 'e'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FeedbackGymGrid
                      entries={gymEntries.map((entry) => ({
                        id: entry.id,
                        createdAtLabel: formatTimestamp(entry.createdAt),
                        waitTimeRating: entry.waitTimeRating,
                        densityRating: entry.densityRating,
                        wouldGoRating: entry.wouldGoRating,
                        occupancyCount: entry.occupancyCount,
                        comment: entry.comment,
                        sourcePath: entry.sourcePath,
                      }))}
                    />
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}