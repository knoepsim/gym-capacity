// Ref links (?ref=<id>) mark reports from people the admin invited. Shared by browser and server code.
//
// Opening a link activates it once per browser: the server hands out a device token <id>_<suffix> with a random
// suffix, up to the link's device limit. Only that token is stored and sent with reports, so the public code
// alone (from a forwarded link or the footer) does not make a report trusted.

export const REF_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789'
export const REF_LENGTH = 6
export const REF_SUFFIX_LENGTH = 6
export const REF_PATTERN = /^[A-Za-z1-9]{6}$/
export const REF_TOKEN_PATTERN = /^([A-Za-z1-9]{6})_([A-Za-z1-9]{6})$/
export const REF_STORAGE_KEY = 'gym-ref'
/** Fired on window when this tab stores a new ref, so visible parts can update without a reload. */
export const REF_CHANGE_EVENT = 'gym-ref-change'

export function isRefId(value: unknown): value is string {
  return typeof value === 'string' && REF_PATTERN.test(value)
}

export function parseRefToken(value: unknown): { refId: string; suffix: string } | null {
  if (typeof value !== 'string') return null
  const match = REF_TOKEN_PATTERN.exec(value)
  return match ? { refId: match[1], suffix: match[2] } : null
}

/** The device token this browser got from the ref link it opened last, or null. */
export function readStoredRefToken(): string | null {
  try {
    const value = window.localStorage.getItem(REF_STORAGE_KEY)
    return parseRefToken(value) ? value : null
  } catch {
    return null
  }
}

export function storeRefToken(token: string): void {
  try {
    window.localStorage.setItem(REF_STORAGE_KEY, token)
    window.dispatchEvent(new Event(REF_CHANGE_EVENT))
  } catch {
    // Private mode or blocked storage: the report is then sent without a ref
  }
}

/** Forgets the device token in this browser. The activated device slot on the server stays used. */
export function clearRefToken(): void {
  try {
    window.localStorage.removeItem(REF_STORAGE_KEY)
    window.dispatchEvent(new Event(REF_CHANGE_EVENT))
  } catch {
    // Blocked storage: nothing to forget
  }
}
