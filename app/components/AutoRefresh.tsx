"use client"
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function AutoRefresh({ interval = 1*60*1000 }: { interval?: number }) {
  const router = useRouter()
  const last = useRef<Record<string, string | null> | null>(null)

  useEffect(() => {
    let mounted = true
    async function poll() {
      try {
        const res = await fetch('/api/status')
        if (!res.ok) return
        const data = await res.json()
        if (!mounted) return
        if (!last.current) {
          last.current = data
          return
        }
        // compare timestamps per gym
        let changed = false
        for (const k of Object.keys(data)) {
          const prev = last.current[k]
          const cur = data[k]
          if (prev !== cur) {
            changed = true
            break
          }
        }
        if (changed) {
          last.current = data
          router.refresh()
        }
      } catch (e) {
        // ignore
      }
    }

    poll()
    const id = setInterval(poll, interval)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [router, interval])

  return null
}
