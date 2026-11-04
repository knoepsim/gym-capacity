import gymConfig from '@/config/gyms.json'

// Favorites live in the browser only (per device), like the recently opened studios.

const FAVORITES_KEY = 'gym-favorites'

// Favorites saved under a gym's former ID still point to the renamed gym.
const CURRENT_ID_BY_PREVIOUS_ID = new Map(
  gymConfig.flatMap((gym) => (('previousIds' in gym ? gym.previousIds : undefined) ?? []).map((previousId) => [previousId, gym.id] as const))
)

export function readFavorites(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]') as unknown
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

export function writeFavorites(ids: string[]) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids))
  } catch {
    // Storage unavailable (private mode): favorites only last for this visit.
  }
}
