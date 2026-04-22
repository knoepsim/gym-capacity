import Link from 'next/link'

export const dynamic = 'force-static'

export default function PublicFilesPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-xl shadow-lg p-8 sm:p-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Statische Dateien (/public)</h1>
          <p className="text-gray-700 mb-6">
            Lege Logos, Downloads und andere statische Assets im Projektordner <strong>public/</strong> ab.
            Diese sind dann direkt über die Root-URL erreichbar.
          </p>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-6">
            <p className="text-sm text-gray-700 font-semibold mb-2">Beispiele</p>
            <ul className="space-y-1 text-sm text-gray-700">
              <li>public/logo.png → /logo.png</li>
              <li>public/downloads/broschuere.pdf → /downloads/broschuere.pdf</li>
              <li>public/icons/app-icon.svg → /icons/app-icon.svg</li>
            </ul>
          </div>

          <p className="text-sm text-gray-600 mb-8">
            Hinweis: Die Route <strong>/public</strong> ist nur eine Info-Seite. Die Dateien selbst werden ohne
            "/public" im Pfad ausgeliefert.
          </p>

          <Link
            href="/"
            className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-3 text-white font-semibold hover:bg-blue-700 transition-colors"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}
