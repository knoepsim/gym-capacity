"use client"

import { useEffect } from 'react'
import { rememberRecentGym } from '@/app/lib/recentGyms'

export function RecentGymTracker({ gymId }: { gymId: string }) {
  useEffect(() => {
    rememberRecentGym(gymId)
  }, [gymId])

  return null
}
