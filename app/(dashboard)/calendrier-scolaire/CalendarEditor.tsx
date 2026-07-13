'use client'

// Saisir les périodes de vacances. Rien de plus.
//
// Trois champs : un nom, un début, une fin. Le nom devient le motif de la
// fermeture — « Vacances de juillet » se lira tel quel dans la semaine. On ne
// réécrit pas les mots de l'utilisateur.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, X, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { periodRangeFr, periodDays, type CalendarPeriod } from '@/lib/planning/school-calendar'
import { savePeriodAction, removePeriodAction } from './actions'

export function CalendarEditor({
  periods,
  followingCount,
  kind = 'scolaire',
  placeholder = 'ex : Vacances de juillet',
  emptyText = 'Aucune période. Saisissez-les depuis le calendrier officiel — MemorIA n’en invente aucune.',
}: {
  periods: CalendarPeriod[]
  followingCount: number
  /** Vacances scolaires ou jours fériés — même mécanique, deux calendriers. */
  kind?: 'scolaire' | 'ferie'
  placeholder?: string
  emptyText?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [editing, setEditing] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [open, setOpen] = useState(false)

  function reset() {
    setEditing(null)
    setLabel('')
    setStartsOn('')
    setEndsOn('')
    setOpen(false)
  }

  function edit(p: CalendarPeriod) {
    setEditing(p.id)
    setLabel(p.label)
    setStartsOn(p.startsOn)
    setEndsOn(p.endsOn)
    setOpen(true)
  }

  function save() {
    if (pending) return
    if (!label.trim()) return toast.error('Donnez un nom à cette période')
    if (!startsOn || !endsOn) return toast.error('Indiquez le début et la fin')
    if (endsOn < startsOn) return toast.error('La fin ne peut pas précéder le début')

    start(async () => {
      const r = await savePeriodAction({
        ...(editing ? { id: editing } : {}),
        kind,
        label: label.trim(),
        startsOn,
        endsOn,
      })
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(
        r.sites > 0
          ? `Enregistré — ${r.sites} chantier${r.sites > 1 ? 's' : ''} mis à jour.`
          : 'Enregistré.',
      )
      reset()
      router.refresh()
    })
  }

  function remove(p: CalendarPeriod) {
    if (pending) return
    start(async () => {
      const r = await removePeriodAction(p.id)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(`« ${p.label} » retiré — les fermetures à venir aussi.`)
      router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      {periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y">
          {periods.map((p) => {
            const n = periodDays(p)
            return (
              <li key={p.id} className="group flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {periodRangeFr(p)} · {n} jour{n > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => edit(p)}
                    disabled={pending}
                    aria-label={`Modifier ${p.label}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    disabled={pending}
                    aria-label={`Retirer ${p.label}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-rose-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {open ? (
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder={placeholder}
            disabled={pending}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Du</span>
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                disabled={pending}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Au</span>
              <input
                type="date"
                value={endsOn}
                min={startsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                disabled={pending}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={pending} size="sm">
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing ? 'Enregistrer' : 'Ajouter'}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
              Annuler
            </Button>
            {followingCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {followingCount} chantier{followingCount > 1 ? 's' : ''} seront mis à jour.
              </span>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" /> Ajouter une période
        </button>
      )}
    </section>
  )
}
