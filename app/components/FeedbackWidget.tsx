"use client"

import { useEffect, useMemo, useState } from 'react'
import { MessageSquarePlus, Star, X } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import gyms from '@/config/gyms.json'

const gymOptions = gyms.map((gym) => ({ id: gym.id, name: gym.name }))

type RatingField = 'waitTimeRating' | 'densityRating' | 'wouldGoRating'

type RatingState = Record<RatingField, number | null>

const defaultRatings: RatingState = {
  waitTimeRating: null,
  densityRating: null,
  wouldGoRating: null,
}

function StarRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 5 }, (_, index) => index + 1).map((rating) => {
          const active = value !== null && rating <= value
          return (
            <button
              key={rating}
              type="button"
              className={`rounded-md border px-3 py-2 transition ${active ? 'border-amber-400 bg-amber-100 text-amber-900' : 'border-border bg-background hover:bg-muted'}`}
              onClick={() => onChange(rating)}
              aria-pressed={value === rating}
              title={`${rating} Sterne`}
            >
              <Star className={`h-4 w-4 ${active ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground'}`} />
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function resolveGymIdFromPath(pathname: string | null): string | null {
  if (!pathname || pathname === '/') {
    return null
  }

  const segment = pathname.split('/').filter(Boolean)[0] ?? null
  return gymOptions.some((gym) => gym.id === segment) ? segment : null
}

export function FeedbackWidget() {
  const pathname = usePathname()
  const detailGymId = useMemo(() => resolveGymIdFromPath(pathname), [pathname])
  const [open, setOpen] = useState(false)
  const [gymId, setGymId] = useState<string | ''>(detailGymId ?? '')
  const [occupancyCount, setOccupancyCount] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [ratings, setRatings] = useState<RatingState>(defaultRatings)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!toastMessage) {
      return
    }

    const timer = window.setTimeout(() => {
      setToastMessage(null)
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [toastMessage])

  useEffect(() => {
    if (detailGymId) {
      setGymId(detailGymId)
    } else if (!open) {
      setGymId('')
    }
  }, [detailGymId, open])

  useEffect(() => {
    if (!gymId) {
      setOccupancyCount(null)
      return
    }

    const controller = new AbortController()

    const loadLatestOccupancy = async () => {
      try {
        const response = await fetch(`/api/occupancy/latest?gymId=${encodeURIComponent(gymId)}`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          return
        }

        const data = (await response.json()) as { latest?: { count?: number | null } | null }
        setOccupancyCount(typeof data.latest?.count === 'number' ? data.latest.count : null)
      } catch {
        if (!controller.signal.aborted) {
          setOccupancyCount(null)
        }
      }
    }

    void loadLatestOccupancy()

    return () => controller.abort()
  }, [gymId])

  const canSubmit = gymId !== '' && Object.values(ratings).some((rating) => rating !== null)

  const resetForm = () => {
    setComment('')
    setRatings(defaultRatings)
    setOccupancyCount(null)
    setMessage(null)
    if (!detailGymId) {
      setGymId('')
    }
  }

  const submit = async () => {
    if (!canSubmit || submitting) {
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gymId,
          occupancyCount,
          ...ratings,
          comment,
          sourcePath: pathname,
        }),
      })

      if (!response.ok) {
        throw new Error('Fehler beim Speichern')
      }

      setToastMessage('Danke, deine Rückmeldung wurde gespeichert.')
      resetForm()
      setOpen(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unbekannter Fehler')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="fixed bottom-6 right-6 z-[80] inline-flex h-14 items-center gap-3 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/25 transition hover:scale-[1.02]"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus className="h-5 w-5" />
        Zustand melden
      </button>

      {toastMessage ? (
        <div className="fixed bottom-24 right-6 z-[95] max-w-sm rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-2xl shadow-black/20">
          {toastMessage}
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <Card className="w-full max-w-2xl border-border/70 bg-card/95 shadow-2xl">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Rückmeldung zum Studio</CardTitle>
                <CardDescription>Bewerte mindestens einen Punkt, damit die Rückmeldung gespeichert werden kann.</CardDescription>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Schließen">
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium">Studio</label>
                <select
                  value={gymId}
                  onChange={(event) => setGymId(event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Bitte Studio auswählen</option>
                  {gymOptions.map((gym) => (
                    <option key={gym.id} value={gym.id}>
                      {gym.name}
                    </option>
                  ))}
                </select>
              </div>

              <StarRow
                label="Wartezeit auf Geräte"
                description="1 = Gerät übersprungen, 5 = alles frei"
                value={ratings.waitTimeRating}
                onChange={(value) => setRatings((current) => ({ ...current, waitTimeRating: value }))}
              />

              <StarRow
                label="Gefühlte Dichte / Enge"
                description="1 = viele Menschen da, 5 = sehr locker/leer"
                value={ratings.densityRating}
                onChange={(value) => setRatings((current) => ({ ...current, densityRating: value }))}
              />

              <StarRow
                label="Würdest du jetzt reingehen?"
                description="1 = viel zu voll, 5 = sehr guter Zeitpunkt"
                value={ratings.wouldGoRating}
                onChange={(value) => setRatings((current) => ({ ...current, wouldGoRating: value }))}
              />

              <div className="space-y-2">
                <label className="text-sm font-medium">Kommentar</label>
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={4}
                  placeholder="Was ist dir aufgefallen?"
                />
              </div>

              {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Abbrechen
                </Button>
                <Button type="button" onClick={submit} disabled={!canSubmit || submitting}>
                  {submitting ? 'Speichere…' : 'Senden'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  )
}
