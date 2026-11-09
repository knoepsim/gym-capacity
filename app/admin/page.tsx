export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { Download, MessageSquare } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { impressionLabel } from '@/app/lib/feedbackScale'
import { describeDevice, deviceKind } from '@/app/lib/userAgent'
import { FeedbackGymGrid } from './FeedbackGymGrid'
import { RefLinkManager } from './RefLinkManager'

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
}

const timestampFormat = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
})

async function getAdminData() {
  try {
    const [entries, refLinks] = await Promise.all([
      prisma.gymFeedback.findMany({
        include: {
          gym: { select: { id: true, name: true } },
          ref: { select: { name: true } },
          activation: { select: { index: true } },
        },
        orderBy: [{ gymId: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.refLink.findMany({
        include: {
          _count: { select: { feedbacks: true, activations: true } },
          activations: {
            orderBy: { index: 'asc' },
            include: { events: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, ip: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    return { entries, refLinks }
  } catch (error) {
    console.error('Fehler beim Laden des Admin-Bereichs:', error)
    return { entries: [], refLinks: [] }
  }
}

export default async function AdminPage() {
  const { entries, refLinks } = await getAdminData()

  const grouped = entries.reduce<Record<string, typeof entries>>((accumulator, entry) => {
    ;(accumulator[entry.gymId] ||= []).push(entry)
    return accumulator
  }, {})

  const gymIds = Object.keys(grouped).sort((left, right) => {
    const leftName = grouped[left]?.[0]?.gym.name ?? left
    const rightName = grouped[right]?.[0]?.gym.name ?? right
    return leftName.localeCompare(rightName, 'de')
  })

  const trustedCount = entries.filter((entry) => entry.refId !== null).length

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-8 pb-24 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Admin</h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{entries.length} Meldungen</Badge>
          <Badge variant="outline">{trustedCount} über Reflink</Badge>
          <Badge variant="outline">{refLinks.length} Reflinks</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/api/export/feedback">
              <Download data-icon="inline-start" />
              Meldungen (CSV)
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/api/export/csv">
              <Download data-icon="inline-start" />
              Messdaten (CSV)
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/api/export/sql">
              <Download data-icon="inline-start" />
              Datenbank (SQL)
            </a>
          </Button>
        </div>
      </header>

      <Tabs defaultValue="feedback" className="gap-6">
        <TabsList>
          <TabsTrigger value="feedback">Zustandsmeldungen</TabsTrigger>
          <TabsTrigger value="refs">Reflinks</TabsTrigger>
        </TabsList>

        <TabsContent value="feedback" className="flex flex-col gap-6">
          {entries.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquare />
                </EmptyMedia>
                <EmptyTitle>Noch keine Meldungen</EmptyTitle>
                <EmptyDescription>Sobald jemand den Zustand meldet, erscheint es hier pro Studio.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            gymIds.map((gymId) => {
              const gymEntries = grouped[gymId] ?? []
              const gymName = gymEntries[0]?.gym.name ?? gymId

              return (
                <Card key={gymId}>
                  <CardHeader>
                    <CardTitle className="text-xl">{gymName}</CardTitle>
                    <CardDescription>
                      {gymEntries.length} Meldung{gymEntries.length === 1 ? '' : 'en'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FeedbackGymGrid
                      entries={gymEntries.map((entry) => ({
                        id: entry.id,
                        createdAtLabel: timestampFormat.format(entry.createdAt),
                        refName: entry.ref ? (entry.activation ? `${entry.ref.name} · Gerät ${entry.activation.index}` : entry.ref.name) : null,
                        impression: impressionLabel(entry.densityRating),
                        estimatedCount: entry.estimatedCount,
                        occupancyCount: entry.occupancyCount,
                        comment: entry.comment,
                      }))}
                    />
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>

        <TabsContent value="refs">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Reflinks</CardTitle>
              <CardDescription>
                Wer einen Reflink öffnet, behält ihn im Browser, bis ein anderer Reflink geöffnet wird. Seine Meldungen tragen dann
                den Namen. Der Name ist für die Person selbst im Footer sichtbar, die interne Anmerkung nur hier. Jeder Link lässt sich nur auf so vielen Geräten aktivieren, wie das Limit erlaubt; danach passiert beim Öffnen nichts mehr.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RefLinkManager
                refLinks={refLinks.map((refLink) => ({
                  id: refLink.id,
                  name: refLink.name,
                  note: refLink.note,
                  devicesUsed: refLink._count.activations,
                  devices: refLink.activations.map((activation) => ({
                    id: activation.id,
                    index: activation.index,
                    revoked: activation.revokedAt !== null,
                    lastIp: activation.events[0]?.ip ?? null,
                    lastSeenLabel: activation.events[0] ? timestampFormat.format(activation.events[0].createdAt) : null,
                    suffix: activation.suffix,
                    kind: deviceKind(activation.userAgent),
                    label: describeDevice(activation.userAgent, activation.deviceModel),
                    ip: activation.ip,
                    createdAtLabel: timestampFormat.format(activation.createdAt),
                  })),
                  deviceLimit: refLink.deviceLimit,
                  createdAtLabel: timestampFormat.format(refLink.createdAt),
                  feedbackCount: refLink._count.feedbacks,
                }))}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  )
}
