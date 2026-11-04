"use client"

import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readFavorites, writeFavorites } from '@/app/lib/favorites'
import { cn } from '@/lib/utils'

// Star button for one studio, used on the detail page. The list is read after mount so the server render
// and the first client render match.
export function FavoriteToggle({ gymId }: { gymId: string }) {
  const [isFavorite, setIsFavorite] = useState(false)

  useEffect(() => {
    setIsFavorite(readFavorites().includes(gymId))

    const onStorage = () => setIsFavorite(readFavorites().includes(gymId))
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [gymId])

  const toggle = () => {
    const current = readFavorites()
    const next = current.includes(gymId) ? current.filter((id) => id !== gymId) : [...current, gymId]
    writeFavorites(next)
    setIsFavorite(next.includes(gymId))
  }

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
      aria-pressed={isFavorite}
      onClick={toggle}
    >
      <Star className={cn(isFavorite && 'fill-warning text-warning')} />
    </Button>
  )
}
