import Link from 'next/link'

export const dynamic = 'force-static'

export default function AssetsInfoPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-xl shadow-lg p-8 sm:p-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Statische Dateien</h1>
          <p className="text-gray-700 mb-6">
            Best Practice in Next.js: Nutze nur den Projektordner <strong>public/</strong> auf Root-Ebene
            fuer Logos, Downloads und statische Assets.
          </p>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-6">
            <p className="text-sm text-gray-700 font-semibold mb-2">Beispiele</p>
            <ul className="space-y-1 text-sm text-gray-700">
              <li>public/test2.txt -&gt; /test2.txt</li>
              <li>public/logo.png -&gt; /logo.png</li>
              <li>public/downloads/broschuere.pdf -&gt; /downloads/broschuere.pdf</li>
            </ul>
          </div>

          <p className="text-sm text-gray-600 mb-8">
            Route-Hinweis: Diese Infoseite liegt unter <strong>/assets</strong>. Eine App-Route
            unter <strong>/public</strong> wird bewusst vermieden, um Verwechslungen mit dem
            echten Static-Ordner zu verhindern.
          </p>

          <div className="flex gap-3">
            <Link
              href="/"
              className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-3 text-white font-semibold hover:bg-blue-700 transition-colors"
            >
              Zur Startseite
            </Link>
            <a
              href="/test2.txt"
              className="inline-flex items-center rounded-lg border border-gray-300 px-5 py-3 text-gray-700 font-semibold hover:bg-gray-100 transition-colors"
            >
              Testdatei oeffnen
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
