import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:px-8">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>Seite nicht gefunden</EmptyTitle>
          <EmptyDescription>
            Dieses Studio oder diese Seite gibt es nicht. Prüfe den Link oder suche das Studio in der Übersicht.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/">Zur Übersicht</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}
