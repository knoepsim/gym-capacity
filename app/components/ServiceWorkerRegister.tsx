"use client"

import { useEffect } from 'react'

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return
    }

    void navigator.serviceWorker.register('/service-worker.js').then((registration) => {
      void registration.update()
    })
  }, [])

  return null
}
