// Recently opened detail pages, kept in the browser only (per-device convenience, like favorites).

const RECENT_KEY = 'gym-recent'
const MAX_RECENT = 6

export function readRecentGyms(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export function rememberRecentGym(gymId: string) {
  try {
    const next = [gymId, ...readRecentGyms().filter((id) => id !== gymId)].slice(0, MAX_RECENT)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable: nothing to remember
  }
}
