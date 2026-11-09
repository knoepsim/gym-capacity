'use client'

import { Fragment, useEffect, useState, useTransition } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Link2, Minus, Monitor, Pencil, Plus, RotateCcw, Smartphone, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { createRefLink, decreaseDeviceLimit, deleteRefLink, increaseDeviceLimit, setDeviceRevoked, updateRefLink, type RefLinkActionResult } from './actions'

export type RefDeviceRow = {
  id: number
  index: number
  revoked: boolean
  lastSeenLabel: string | null
  suffix: string
  kind: 'mobile' | 'desktop'
  label: string
  ip: string | null
  createdAtLabel: string
}

export type RefLinkRow = {
  id: string
  name: string
  note: string | null
  devicesUsed: number
  devices: RefDeviceRow[]
  deviceLimit: number
  createdAtLabel: string
  feedbackCount: number
}

export function RefLinkManager({ refLinks }: { refLinks: RefLinkRow[] }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editNote, setEditNote] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => setOrigin(window.location.origin), [])

  const linkFor = (id: string) => `${origin}/?ref=${id}`

  const run = (action: () => Promise<RefLinkActionResult>, onSuccess: () => void) => {
    startTransition(async () => {
      try {
        const result = await action()
        if (result.ok) onSuccess()
        else toast.error(result.error)
      } catch {
        toast.error('Aktion fehlgeschlagen.')
      }
    })
  }

  const create = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const result = await createRefLink(name, note)
        if (result.ok) {
          setName('')
          setNote('')
          toast.success('Reflink erstellt.')
        } else {
          setError(result.error)
        }
      } catch {
        setError('Aktion fehlgeschlagen.')
      }
    })
  }

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(id))
      toast.success('Link kopiert.')
    } catch {
      toast.error('Kopieren nicht möglich. Link bitte von Hand markieren.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={create} className="sm:max-w-lg">
        <FieldGroup>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="ref-name">Name</FieldLabel>
            <Input
              id="ref-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Vorname, z. B. Max"
              maxLength={80}
              aria-invalid={error ? true : undefined}
            />
            <FieldDescription>Sichtbar für die Person im Footer und für dich bei den Meldungen.</FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="ref-note">Interne Anmerkung (optional)</FieldLabel>
            <Textarea
              id="ref-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="z. B. Trainingspartner, meist abends da"
              maxLength={1000}
              rows={2}
            />
            <FieldDescription>Nur hier im Admin-Bereich sichtbar.</FieldDescription>
          </Field>
          <Button type="submit" className="self-start" disabled={pending || !name.trim()}>
            <Plus data-icon="inline-start" />
            Reflink erstellen
          </Button>
        </FieldGroup>
      </form>

      {refLinks.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2 />
            </EmptyMedia>
            <EmptyTitle>Noch keine Reflinks</EmptyTitle>
            <EmptyDescription>Erstelle einen Link pro Person und schick ihn ihr. Ihre Meldungen tragen dann ihren Namen.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Interne Anmerkung</th>
                <th className="px-3 py-2 font-medium">Link</th>
                <th className="px-3 py-2 font-medium">Geräte</th>
                <th className="px-3 py-2 text-right font-medium">Meldungen</th>
                <th className="px-3 py-2 font-medium">Erstellt</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {refLinks.map((refLink) => {
                const editing = editingId === refLink.id
                const formId = `ref-edit-${refLink.id}`

                const expanded = expandedId === refLink.id

                return (
                  <Fragment key={refLink.id}>
                  <tr className="border-t align-top">
                    <td className="px-3 py-2 font-medium">
                      {editing ? (
                        <form
                          id={formId}
                          onSubmit={(event) => {
                            event.preventDefault()
                            run(() => updateRefLink(refLink.id, editName, editNote), () => setEditingId(null))
                          }}
                        >
                          <Input
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            maxLength={80}
                            className="h-8 min-w-32"
                            aria-label="Name"
                            autoFocus
                          />
                        </form>
                      ) : (
                        refLink.name
                      )}
                    </td>
                    <td className="max-w-xs px-3 py-2 text-muted-foreground">
                      {editing ? (
                        <Textarea
                          form={formId}
                          value={editNote}
                          onChange={(event) => setEditNote(event.target.value)}
                          maxLength={1000}
                          rows={2}
                          className="min-w-48"
                          aria-label="Interne Anmerkung"
                        />
                      ) : (
                        <span className="whitespace-pre-wrap">{refLink.note ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap">
                          {origin ? linkFor(refLink.id) : `?ref=${refLink.id}`}
                        </code>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => copy(refLink.id)} aria-label={`Link für ${refLink.name} kopieren`}>
                          <Copy />
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setExpandedId(expanded ? null : refLink.id)}
                          aria-expanded={expanded}
                          aria-label={`Geräte von ${refLink.name} ${expanded ? 'ausblenden' : 'anzeigen'}`}
                        >
                          {expanded ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={pending || refLink.deviceLimit <= Math.max(refLink.devicesUsed, 1)}
                          onClick={() => run(() => decreaseDeviceLimit(refLink.id), () => toast.success(`Limit für ${refLink.name} verringert.`))}
                          aria-label={`Gerätelimit für ${refLink.name} verringern`}
                          title="Limit um 1 verringern (nicht unter die genutzten Geräte)"
                        >
                          <Minus />
                        </Button>
                        <span
                          className={cn('min-w-10 text-center tabular-nums', refLink.devicesUsed >= refLink.deviceLimit && 'font-medium text-destructive')}
                          title={refLink.devicesUsed >= refLink.deviceLimit ? 'Limit erreicht: weitere Geräte werden ignoriert' : undefined}
                        >
                          {refLink.devicesUsed} / {refLink.deviceLimit}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={pending}
                          onClick={() => run(() => increaseDeviceLimit(refLink.id), () => toast.success(`Limit für ${refLink.name} erhöht.`))}
                          aria-label={`Gerätelimit für ${refLink.name} erhöhen`}
                          title="Limit um 1 erhöhen"
                        >
                          <Plus />
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{refLink.feedbackCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{refLink.createdAtLabel}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {editing ? (
                          <Fragment key="editing">
                            <Button
                              type="submit"
                              form={formId}
                              variant="ghost"
                              size="icon-sm"
                              disabled={pending || !editName.trim()}
                              aria-label="Speichern"
                            >
                              <Check />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditingId(null)} aria-label="Abbrechen">
                              <X />
                            </Button>
                          </Fragment>
                        ) : (
                          <Fragment key="viewing">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${refLink.name} bearbeiten`}
                              onClick={() => {
                                setEditingId(refLink.id)
                                setEditName(refLink.name)
                                setEditNote(refLink.note ?? '')
                              }}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Reflink von ${refLink.name} löschen`}
                              disabled={pending}
                              onClick={() => {
                                const ok = window.confirm(
                                  `Reflink von ${refLink.name} löschen? Der Link funktioniert dann nicht mehr. Bisherige Meldungen bleiben erhalten, aber ohne Namen.`
                                )
                                if (ok) run(() => deleteRefLink(refLink.id), () => toast.success('Reflink gelöscht.'))
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </Fragment>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="bg-muted/30">
                      <td colSpan={7} className="px-3 py-3">
                        {refLink.devices.length === 0 ? (
                          <p className="text-muted-foreground">Noch kein Gerät aktiviert.</p>
                        ) : (
                          <ul className="flex flex-col gap-1.5">
                            {refLink.devices.map((device) => (
                              <li key={device.index} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                <span className={cn('flex items-center gap-1.5 font-medium', device.revoked && 'text-muted-foreground line-through')}>
                                  {device.kind === 'mobile' ? (
                                    <Smartphone className="size-4 text-muted-foreground" aria-label="Mobilgerät" />
                                  ) : (
                                    <Monitor className="size-4 text-muted-foreground" aria-label="PC oder Laptop" />
                                  )}
                                  Gerät {device.index}
                                </span>
                                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                  {refLink.id}_{device.suffix}
                                </code>
                                <span className={cn(device.revoked && 'text-muted-foreground line-through')}>{device.label}</span>
                                <span className="text-muted-foreground">IP {device.ip ?? 'unbekannt'}</span>
                                <span className="text-muted-foreground">aktiviert {device.createdAtLabel}</span>
                                <span className="text-muted-foreground">zuletzt aktiv {device.lastSeenLabel ?? 'nie'}</span>
                                {device.revoked ? <Badge variant="destructive">Gelöscht</Badge> : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() => {
                                    if (device.revoked) {
                                      run(() => setDeviceRevoked(device.id, false), () => toast.success(`Gerät ${device.index} wiederhergestellt.`))
                                    } else if (
                                      window.confirm(
                                        `Gerät ${device.index} von ${refLink.name} löschen? Meldungen von diesem Gerät kommen dann ohne Namen an. Der Platz im Limit bleibt belegt.`
                                      )
                                    ) {
                                      run(() => setDeviceRevoked(device.id, true), () => toast.success(`Gerät ${device.index} gelöscht.`))
                                    }
                                  }}
                                >
                                  {device.revoked ? <RotateCcw data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
                                  {device.revoked ? 'Wiederherstellen' : 'Löschen'}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
