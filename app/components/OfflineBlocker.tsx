"use client"

import { ReactNode, useEffect, useState } from 'react'
import { Loader2, WifiOff } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function OfflineBlocker({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined

    const checkConnection = async () => {
      setStatus('checking')

      try {
        timer = window.setTimeout(() => controller.abort(), 3000)
        const response = await fetch('/api/status', {
          cache: 'no-store',
          signal: controller.signal,
        })

        setStatus(response.ok ? 'online' : 'offline')
      } catch {
        setStatus('offline')
      } finally {
        if (timer !== undefined) {
          window.clearTimeout(timer)
        }
      }
    }

    const onOnline = () => {
      void checkConnection()
    }

    const onOffline = () => {
      setStatus('offline')
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    void checkConnection()

    return () => {
      controller.abort()
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  if (status === 'online') {
    return <>{children}</>
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/95 px-6 text-center backdrop-blur-sm">
      <Card className="w-full max-w-md border-border/70 shadow-2xl">
        <CardHeader className="items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {status === 'checking' ? <Loader2 className="h-6 w-6 animate-spin" /> : <WifiOff className="h-6 w-6" />}
          </div>
          <CardTitle className="text-2xl tracking-tight">
            {status === 'checking' ? 'Verbindung wird aufgebaut' : 'Keine Verbindung'}
          </CardTitle>
          <CardDescription>
            {status === 'checking'
              ? 'Gym Auslastungen werden geladen. Bitte warten...'
              : 'Die App benötigt Live-Daten. Solange keine Verbindung besteht, wird nichts angezeigt.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8" />
      </Card>
    </div>
  )
}
