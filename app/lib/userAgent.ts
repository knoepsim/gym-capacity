// Short human label for a device from its user agent, e.g. "iPhone · Safari" or "Pixel 8 · Chrome".
// iOS browsers never reveal the exact model, and Chromium on Android only reports it via client hints.

function browserName(ua: string): string | null {
  if (/EdgA?\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox'
  if (/CriOS\/|Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return null
}

function systemName(ua: string): string | null {
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Linux/.test(ua)) return 'Linux'
  return null
}

export function describeDevice(userAgent: string | null, model: string | null): string {
  const ua = userAgent ?? ''
  // A real model name beats the generic "Android"; Chrome's reduced UA reports the placeholder "K"
  const system = systemName(ua)
  const hasModel = Boolean(model && model !== 'K')
  const device = hasModel ? model : system
  // Android with no model: say so, so a missing name is not mistaken for a bug in the admin list
  const note = !hasModel && system === 'Android' ? 'Modell nicht übermittelt' : null
  const parts = [device, browserName(ua), note].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Unbekanntes Gerät'
}

/** Phones and tablets count as mobile; everything else is a PC or laptop. */
export function deviceKind(userAgent: string | null): 'mobile' | 'desktop' {
  return /Mobi|iPhone|iPad|Android/.test(userAgent ?? '') ? 'mobile' : 'desktop'
}
