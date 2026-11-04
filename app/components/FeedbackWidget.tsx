"use client"

import { useEffect, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { FEEDBACK_IMPRESSIONS } from '@/app/lib/feedbackScale'

// Feedback for one studio; rendered on its detail page. The current reading is deliberately not shown in the
// form: members should judge by what they see, not by the number the app displays.
export function FeedbackWidget({ gymId, gymName }: { gymId: string; gymName: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [occupancyCount, setOccupancyCount] = useState<number | null>(null)
  const [impression, setImpression] = useState<number | null>(null)
  const [estimatedCount, setEstimatedCount] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Raw counter value at the moment the form is opened, stored next to the member's answers
  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    fetch(`/api/occupancy/latest?gymId=${encodeURIComponent(gymId)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { latest?: { count?: number | null } | null } | null) =>
        setOccupancyCount(typeof data?.latest?.count === 'number' ? data.latest.count : null)
      )
      .catch(() => {
        if (!controller.signal.aborted) setOccupancyCount(null)
      })

    return () => controller.abort()
  }, [gymId, open])

  const parsedEstimate = estimatedCount.trim() === '' ? null : Number(estimatedCount)
  const estimateValid = parsedEstimate === null || (Number.isInteger(parsedEstimate) && parsedEstimate >= 0 && parsedEstimate <= 1000)
  const canSubmit = estimateValid && (parsedEstimate !== null || impression !== null)

  const resetForm = () => {
    setImpression(null)
    setEstimatedCount('')
    setComment('')
    setOccupancyCount(null)
    setMessage(null)
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
          estimatedCount: parsedEstimate,
          densityRating: impression,
          comment,
          sourcePath: pathname,
        }),
      })

      if (!response.ok) {
        throw new Error('Fehler beim Speichern')
      }

      toast.success('Danke für deine Rückmeldung.')
      resetForm()
      setOpen(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unbekannter Fehler')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="fixed right-6 bottom-6 z-40 rounded-full shadow-lg">
          <MessageSquarePlus data-icon="inline-start" />
          Zustand melden
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Wie voll ist es gerade?</DialogTitle>
          <DialogDescription>{gymName}</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            value={impression === null ? '' : String(impression)}
            onValueChange={(value) => setImpression(value ? Number(value) : null)}
            aria-label="Eindruck"
            className="grid w-full grid-cols-5"
          >
            {FEEDBACK_IMPRESSIONS.map((entry) => (
              <ToggleGroupItem key={entry.rating} value={String(entry.rating)} className="px-1 text-xs sm:text-sm">
                {entry.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Field data-invalid={!estimateValid || undefined}>
            <FieldLabel htmlFor="feedback-estimated-count">Geschätzte Personenzahl (optional)</FieldLabel>
            <Input
              id="feedback-estimated-count"
              type="number"
              inputMode="numeric"
              min={0}
              max={1000}
              step={1}
              value={estimatedCount}
              onChange={(event) => setEstimatedCount(event.target.value)}
              placeholder="z. B. 40"
              aria-invalid={!estimateValid || undefined}
              className="max-w-40"
            />
            {estimateValid ? (
              <FieldDescription>Grob schätzen reicht. Damit wird die Anzeige genauer.</FieldDescription>
            ) : (
              <FieldError>Bitte eine ganze Zahl zwischen 0 und 1000 eingeben.</FieldError>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="feedback-comment">Anmerkung (optional)</FieldLabel>
            <Textarea id="feedback-comment" value={comment} onChange={(event) => setComment(event.target.value)} rows={2} />
          </Field>

          {message ? <FieldError>{message}</FieldError> : null}
        </FieldGroup>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Abbrechen</Button>
          </DialogClose>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? 'Speichere…' : 'Senden'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
