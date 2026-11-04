// How full a member says it feels, left (quiet) to right (packed). The numbers keep the meaning of the
// densityRating column: 1 = many people, 5 = very quiet.
export const FEEDBACK_IMPRESSIONS = [
  { rating: 5, label: 'Leer' },
  { rating: 4, label: 'Locker' },
  { rating: 3, label: 'Mittel' },
  { rating: 2, label: 'Voll' },
  { rating: 1, label: 'Sehr voll' },
] as const

export function impressionLabel(rating: number | null): string | null {
  return FEEDBACK_IMPRESSIONS.find((entry) => entry.rating === rating)?.label ?? null
}
