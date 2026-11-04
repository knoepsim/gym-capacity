"use client"

import { useEffect, useMemo, useState } from 'react'
import { Search, SearchX, Star } from 'lucide-react'
import { GymCard } from './GymCard'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import gymConfig from '@/config/gyms.json'
import { readRecentGyms } from '@/app/lib/recentGyms'

const FAVORITES_KEY = 'gym-favorites'
const MAX_RESULTS = 30
// Region whose studios are suggested before the visitor picked any favorite
const SUGGESTION_REGION = 'BW'

// Favorites saved under a gym's former ID still point to the renamed gym.
const CURRENT_ID_BY_PREVIOUS_ID = new Map(
  gymConfig.flatMap((gym) => (('previousIds' in gym ? gym.previousIds : undefined) ?? []).map((previousId) => [previousId, gym.id] as const))
)

const REGION_NAMES: Record<string, string> = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
}

export type OverviewGym = {
  id: string
  name: string
  provider: string
  unit: 'persons' | 'percent'
  region: string | null
  city: string | null
  latest: { count: number; maxCount: number; timestamp: string } | null
  dailySeries: Array<{ hour: number; actual_count: number | null; forecast_count: number | null }>
  trendDir: 'up' | 'down' | 'equal'
  closedStatus: { isLikelyClosed: boolean; stableMinutes: number }
  historyDays: number
  maxCount: number
}

interface OverviewClientProps {
  gyms: OverviewGym[]
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function searchText(gym: OverviewGym): string {
  return normalize([gym.name, gym.city, gym.region, gym.region ? REGION_NAMES[gym.region] : null].filter(Boolean).join(' '))
}

function readFavorites(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) {
      return []
    }

    const ids = parsed
      .filter((value): value is string => typeof value === 'string')
      .map((id) => CURRENT_ID_BY_PREVIOUS_ID.get(id) ?? id)
    return Array.from(new Set(ids))
  } catch {
    return []
  }
}

function writeFavorites(ids: string[]) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids))
  } catch {
    // Storage unavailable (private mode): favorites only last for this visit.
  }
}

export function OverviewClient({ gyms }: OverviewClientProps) {
  const [favorites, setFavorites] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    setFavorites(readFavorites())
    setRecent(readRecentGyms())

    const onStorage = () => {
      setFavorites(readFavorites())
      setRecent(readRecentGyms())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const gymById = useMemo(() => new Map(gyms.map((gym) => [gym.id, gym])), [gyms])
  const indexedGyms = useMemo(() => gyms.map((gym) => ({ gym, text: searchText(gym) })), [gyms])
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const isSearching = query.trim() !== ''

  const byFavoriteThenName = (left: OverviewGym, right: OverviewGym) => {
    const favoriteDiff = Number(favoriteSet.has(right.id)) - Number(favoriteSet.has(left.id))
    return favoriteDiff !== 0 ? favoriteDiff : left.name.localeCompare(right.name, 'de')
  }

  const searchResults = useMemo(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []
    return indexedGyms.filter(({ text }) => tokens.every((token) => text.includes(token))).map(({ gym }) => gym)
  }, [indexedGyms, query])

  const favoriteGyms = gyms.filter((gym) => favoriteSet.has(gym.id)).sort(byFavoriteThenName)
  const recentGyms = recent
    .map((id) => gymById.get(id))
    .filter((gym): gym is OverviewGym => gym !== undefined && !favoriteSet.has(gym.id))
    .slice(0, 3)
  // First visit: suggest the home region so the page is not empty before anything was searched
  const shownIds = new Set([...favoriteGyms, ...recentGyms].map((gym) => gym.id))
  const suggestedGyms =
    favoriteGyms.length === 0
      ? gyms
          .filter((gym) => gym.region === SUGGESTION_REGION && !shownIds.has(gym.id) && gym.latest !== null)
          // Counter-based studios (persons, longest history) before percentage-only sources
          .sort((left, right) => Number(right.unit === 'persons') - Number(left.unit === 'persons') || left.name.localeCompare(right.name, 'de'))
          .slice(0, 6)
      : []

  const toggleFavorite = (gymId: string) => {
    setFavorites((current) => {
      const next = current.includes(gymId) ? current.filter((id) => id !== gymId) : [...current, gymId]
      writeFavorites(next)
      return next
    })
  }

  const renderGrid = (list: OverviewGym[]) => (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {list.map((gym) => (
        <GymCard
          key={gym.id}
          id={gym.id}
          name={gym.name}
          location={[gym.city, gym.region].filter(Boolean).join(', ')}
          region={gym.region}
          unit={gym.unit}
          hasData={gym.latest !== null}
          currentCount={gym.latest?.count ?? 0}
          maxCount={gym.maxCount}
          lastUpdate={gym.latest?.timestamp ?? null}
          dailySeries={gym.dailySeries}
          isLikelyClosed={gym.closedStatus.isLikelyClosed}
          historyDays={gym.historyDays}
          isFavorite={favoriteSet.has(gym.id)}
          onToggleFavorite={toggleFavorite}
        />
      ))}
    </div>
  )

  // Headings only help when more than one list is shown
  const sections = [
    { title: 'Favoriten', list: favoriteGyms },
    { title: 'Zuletzt angesehen', list: recentGyms },
    { title: 'Vorschläge', list: suggestedGyms },
  ].filter((entry) => entry.list.length > 0)
  const showHeadings = sections.length > 1

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <InputGroup className="h-11 max-w-xl">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Studio oder Stadt suchen …"
            aria-label="Studios durchsuchen"
          />
        </InputGroup>
        {favoriteGyms.length === 0 && !isSearching && sections.length > 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Star className="size-4" />
            Markiere dein Studio mit dem Stern, dann steht es hier oben.
          </p>
        ) : null}
        {isSearching && searchResults.length > MAX_RESULTS ? (
          <p className="text-sm text-muted-foreground">
            {searchResults.length} Treffer, die ersten {MAX_RESULTS} werden angezeigt. Verfeinere die Suche.
          </p>
        ) : null}
      </div>

      {isSearching ? (
        searchResults.length > 0 ? (
          renderGrid([...searchResults].sort(byFavoriteThenName).slice(0, MAX_RESULTS))
        ) : (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>Kein Studio gefunden</EmptyTitle>
              <EmptyDescription>Versuch es mit der Stadt oder dem Bundesland.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : sections.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Star />
            </EmptyMedia>
            <EmptyTitle>Such dein Studio</EmptyTitle>
            <EmptyDescription>Markiere es mit dem Stern, dann steht es hier.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        sections.map((entry) => (
          <section key={entry.title} className="flex flex-col gap-3">
            {showHeadings ? <h2 className="font-heading text-lg font-semibold">{entry.title}</h2> : null}
            {renderGrid(entry.list)}
          </section>
        ))
      )}
    </div>
  )
}
