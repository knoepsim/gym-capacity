"use client"

import { useEffect, useMemo, useState } from 'react'
import { GymCard } from './GymCard'

const FAVORITES_KEY = 'gym-favorites'

type OverviewGym = {
  id: string
  name: string
  latest: { count: number; maxCount: number; timestamp: string } | null
  dailySeries: Array<{ hour: number; actual_count: number | null; forecast_count: number | null }>
  trendDir: 'up' | 'down' | 'equal'
  closedStatus: { isLikelyClosed: boolean; stableMinutes: number }
}

interface OverviewClientProps {
  gyms: OverviewGym[]
  maxCapacityByGym: Record<string, number>
}

function readFavorites(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function writeFavorites(ids: string[]) {
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids))
}

export function OverviewClient({ gyms, maxCapacityByGym }: OverviewClientProps) {
  const [favorites, setFavorites] = useState<string[]>([])

  useEffect(() => {
    setFavorites(readFavorites())

    const onStorage = () => setFavorites(readFavorites())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const orderedGyms = useMemo(() => {
    const favoriteSet = new Set(favorites)
    return [...gyms].sort((left, right) => {
      const leftFav = favoriteSet.has(left.id) ? 1 : 0
      const rightFav = favoriteSet.has(right.id) ? 1 : 0
      if (leftFav !== rightFav) {
        return rightFav - leftFav
      }
      return left.name.localeCompare(right.name, 'de')
    })
  }, [favorites, gyms])

  const toggleFavorite = (gymId: string) => {
    setFavorites((current) => {
      const next = current.includes(gymId) ? current.filter((id) => id !== gymId) : [...current, gymId]
      writeFavorites(next)
      return next
    })
  }

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
      {orderedGyms.map((gym) => (
        <div key={gym.id} className="flex flex-col">
          <GymCard
            id={gym.id}
            name={gym.name}
            currentCount={gym.latest?.count ?? 0}
            maxCount={maxCapacityByGym[gym.id] ?? gym.latest?.maxCount ?? 160}
            lastUpdate={gym.latest?.timestamp ?? new Date().toISOString()}
            dailySeries={gym.dailySeries ?? []}
            isLikelyClosed={gym.closedStatus?.isLikelyClosed ?? false}
            closedStableMinutes={gym.closedStatus?.stableMinutes ?? 0}
            isFavorite={favorites.includes(gym.id)}
            onToggleFavorite={toggleFavorite}
          />
        </div>
      ))}
    </div>
  )
}
