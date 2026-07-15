'use client'

// Saisir les périodes de vacances. Rien de plus.
//
// Trois champs : un nom, un début, une fin. Le nom devient le motif de la
// fermeture — « Vacances de juillet » se lira tel quel dans la semaine. On ne
// réécrit pas les mots de l'utilisateur.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, X, Pencil, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { periodRangeFr, periodDays, type CalendarPeriod } from '@/lib/planning/school-calendar'
import { savePeriodAction, removePeriodAction, importNcCalendar2026Action } from './actions'

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
  // Retirer une période EFFACE les fermetures dérivées : on confirme avant.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

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

  function importNc2026() {
    if (pending) return
    start(async () => {
      const r = await importNcCalendar2026Action()
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      if (r.created === 0) {
        toast.info('Le calendrier 2026 est déjà là — rien à ajouter.')
      } else {
        toast.success(
          `${r.created} période${r.created > 1 ? 's' : ''} ajoutée${r.created > 1 ? 's' : ''}` +
            (r.sites > 0 ? ` · ${r.sites} chantier${r.sites > 1 ? 's' : ''} mis à jour` : ''),
        )
      }
      router.refresh()
    })
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
    setConfirmDelete(null)
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
                {confirmDelete === p.id ? (
                  // Confirmation LÉGÈRE avant une action à conséquences : retirer
                  // une période efface les fermetures qui en découlent.
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs">
                    <span className="text-rose-700">
                      Retirer&#8239;?
                      {followingCount > 0 && (
                        <span className="text-muted-foreground">
                          {' '}{followingCount} chantier{followingCount > 1 ? 's' : ''} concerné
                          {followingCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      disabled={pending}
                      className="rounded-md bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700"
                    >
                      Retirer
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      disabled={pending}
                      className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      Annuler
                    </button>
                  </span>
                ) : (
                  // Actions TOUJOURS visibles au doigt (< md) ; révélées au survol
                  // sur desktop seulement. Avant, opacity-0 group-hover les rendait
                  // inexistantes sur téléphone — l'appareil du terrain.
                  <span className="flex shrink-0 items-center gap-2 opacity-100 transition-opacity md:gap-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => edit(p)}
                      disabled={pending}
                      aria-label={`Modifier ${p.label}`}
                      className="rounded-md p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground md:p-1.5"
                    >
                      <Pencil className="h-4 w-4 md:h-3.5 md:w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(p.id)}
                      disabled={pending}
                      aria-label={`Retirer ${p.label}`}
                      className="rounded-md p-2.5 text-muted-foreground hover:bg-muted hover:text-rose-700 md:p-1.5"
                    >
                      <X className="h-4 w-4 md:h-3.5 md:w-3.5" />
                    </button>
                  </span>
                )}
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> Ajouter une période
          </button>

          {/* Les dates calédoniennes 2026, prêtes à importer. Un humain clique :
              l'écran ne pré-remplit toujours rien de lui-même. Rejouable — une
              période déjà là n'est pas recréée. */}
          <button
            type="button"
            onClick={importNc2026}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Importer le calendrier 2026 (Nouvelle-Calédonie)
          </button>
        </div>
      )}
    </section>
  )
}
