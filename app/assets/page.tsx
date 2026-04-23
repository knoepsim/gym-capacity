import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-static'

export default function AssetsInfoPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <Card className="border-border/70 bg-card/90">
          <CardHeader>
            <CardTitle className="text-3xl">Statische Dateien</CardTitle>
            <CardDescription>
            Best Practice in Next.js: Nutze nur den Projektordner <strong>public/</strong> auf Root-Ebene
            fuer Logos, Downloads und statische Assets.
            </CardDescription>
          </CardHeader>
          <CardContent>

            <div className="mb-6 rounded-lg border border-border bg-muted/40 p-4">
              <p className="mb-2 text-sm font-semibold">Beispiele</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
              <li>public/test2.txt -&gt; /test2.txt</li>
              <li>public/logo.png -&gt; /logo.png</li>
              <li>public/downloads/broschuere.pdf -&gt; /downloads/broschuere.pdf</li>
              </ul>
            </div>

            <p className="mb-8 text-sm text-muted-foreground">
            Route-Hinweis: Diese Infoseite liegt unter <strong>/assets</strong>. Eine App-Route
            unter <strong>/public</strong> wird bewusst vermieden, um Verwechslungen mit dem
            echten Static-Ordner zu verhindern.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/">Zur Startseite</Link>
              </Button>
              <Button asChild variant="outline">
                <a href="/test2.txt">Testdatei oeffnen</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
