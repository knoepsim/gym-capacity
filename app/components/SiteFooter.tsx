'use client'

import { useEffect, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { REF_CHANGE_EVENT, REF_STORAGE_KEY, clearRefToken, parseRefToken, readStoredRefToken } from '@/app/lib/refLink'

// Easter egg: this many clicks on the paperclip within the window forget the ref in this browser
const EGG_CLICKS = 5
const EGG_WINDOW_MS = 5000

export function SiteFooter() {
  const clicks = useRef<number[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  // Only the public code is shown; the device suffix is the secret part and stays out of screenshots
  const code = parseRefToken(token)?.refId ?? null

  // Display name from the server; the internal note never leaves the admin area
  useEffect(() => {
    setName(null)
    if (!token) return

    const controller = new AbortController()
    fetch(`/api/ref/${encodeURIComponent(token)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { name?: unknown } | null) => setName(typeof data?.name === 'string' ? data.name : null))
      .catch(() => {})

    return () => controller.abort()
  }, [token])

  useEffect(() => {
    const update = () => setToken(readStoredRefToken())
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === REF_STORAGE_KEY) update()
    }

    update()
    window.addEventListener(REF_CHANGE_EVENT, update)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(REF_CHANGE_EVENT, update)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const onPaperclip = () => {
    const now = Date.now()
    clicks.current = [...clicks.current.filter((time) => now - time < EGG_WINDOW_MS), now]
    if (clicks.current.length >= EGG_CLICKS) {
      clicks.current = []
      clearRefToken()
      toast('Ref-Link in diesem Browser entfernt.')
    }
  }

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>
          Gym Auslastung · Live-Daten der Studios, Prognosen ohne Gewähr ·{' '}
          {/* Plain link: a prefetch of the login-protected page would only produce 401s */}
          <a href="/admin" className="underline underline-offset-4 hover:text-foreground">
            Admin
          </a>
        </p>
        {code && name ? (
          <p className="flex items-center gap-1.5">
            <button type="button" onClick={onPaperclip} aria-hidden tabIndex={-1} className="cursor-default select-none">
              <Paperclip className="size-4" />
            </button>
            Ref-Code <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{code}</code>
            <span className="text-foreground">· {name}</span>
          </p>
        ) : null}
      </div>
    </footer>
  )
}
