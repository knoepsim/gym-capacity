// How full a member says it feels, left (quiet) to right (packed). The numbers keep the meaning of the
// densityRating column: 1 = many people, 5 = very quiet. The descriptions use things a member can observe
// (free machines, waiting) so answers stay comparable between people instead of depending on mood.
export const FEEDBACK_IMPRESSIONS = [
  { rating: 5, label: 'Leer', description: 'Fast niemand da. Alle Geräte frei, du hast den Raum für dich.' },
  { rating: 4, label: 'Locker', description: 'Einige Leute da, aber jedes Gerät sofort frei. Kein Warten.' },
  { rating: 3, label: 'Mittel', description: 'Etwa die Hälfte der Geräte belegt. An einzelnen Geräten kurz warten.' },
  { rating: 2, label: 'Voll', description: 'Die meisten Geräte belegt. Du wartest an mehreren Geräten oder weichst aus.' },
  { rating: 1, label: 'Sehr voll', description: 'Fast alles belegt, an Racks oder Kardio warten mehrere Leute auf dasselbe Gerät. Training nur mit langem Warten.' },
] as const

export function impressionLabel(rating: number | null): string | null {
  return FEEDBACK_IMPRESSIONS.find((entry) => entry.rating === rating)?.label ?? null
}
