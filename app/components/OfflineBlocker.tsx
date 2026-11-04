"use client"

import { ReactNode, useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

// The page always renders; when the server is unreachable a notice explains that the shown values may be
// outdated (instead of hiding everything behind a full-screen loader on every start).
export function OfflineBlocker({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let cancelled = false

    const checkConnection = async () => {
      try {
        const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
        if (!cancelled) setOffline(!response.ok)
      } catch {
        if (!cancelled) setOffline(true)
      }
    }

    const onOnline = () => void checkConnection()
    const onOffline = () => setOffline(true)

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    if (navigator.onLine) void checkConnection()
    else setOffline(true)

    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return (
    <>
      {offline ? (
        <div className="sticky top-14 z-30 mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <Alert>
            <WifiOff />
            <AlertTitle>Keine Verbindung</AlertTitle>
            <AlertDescription>Die angezeigten Werte können veraltet sein. Sobald du wieder online bist, wird aktualisiert.</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {children}
    </>
  )
}
