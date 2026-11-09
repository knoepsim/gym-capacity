'use client'

import { useEffect } from 'react'
import { isRefId, parseRefToken, readStoredRefToken, storeRefToken } from '@/app/lib/refLink'

type UserAgentData = {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>
}

// Device model via client hints. Only Chromium on Android answers; Safari and Firefox give nothing
async function readDeviceModel(): Promise<string | null> {
  try {
    const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
    const values = await data?.getHighEntropyValues?.(['model'])
    return values?.model?.trim() || null
  } catch {
    return null
  }
}

// Activates ?ref=<id> for this browser. The device token stays until another ref link is activated.
export function RefTracker() {
  useEffect(() => {
    // Tell the server this device is in use (once per tab session; the server throttles further)
    const stored = readStoredRefToken()
    try {
      if (stored && !window.sessionStorage.getItem('gym-ref-seen')) {
        window.sessionStorage.setItem('gym-ref-seen', '1')
        fetch('/api/ref/seen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: stored }),
        }).catch(() => {})
      }
    } catch {
      // Blocked sessionStorage: skip the ping
    }

    const url = new URL(window.location.href)
    const ref = url.searchParams.get('ref')
    if (ref === null) return

    // Drop the parameter first, so copying the address bar never shares the ref link
    url.searchParams.delete('ref')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)

    if (!isRefId(ref)) return
    // Same link opened again in this browser: keep the device, do not use up another one
    if (parseRefToken(readStoredRefToken())?.refId === ref) return

    // A link at its device limit returns nothing; the browser then keeps the ref it already had
    readDeviceModel()
      .then((model) =>
        fetch('/api/ref/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref, model }),
        })
      )
      .then((response) => (response.status === 200 ? response.json() : null))
      .then((data: { token?: unknown } | null) => {
        if (data && parseRefToken(data.token)) storeRefToken(data.token as string)
      })
      .catch(() => {})
  }, [])

  return null
}
