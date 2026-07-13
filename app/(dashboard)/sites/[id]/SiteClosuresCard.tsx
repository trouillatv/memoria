'use client'

// PL2 — « Fermetures » sur la fiche chantier. Pas une sous-route : le besoin de
// Guillaume est « ce magasin est fermé », pas un module autonome.
//
// Ce que cette carte NE fait PAS : déplacer, annuler, alerter. Déclarer une
// fermeture ne touche aucune intervention. Le conflit « site fermé, prestation
// prévue » sera SIGNALÉ par PL3, et tranché par l'humain.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarOff, Plus, Loader2, Pencil, GraduationCap, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RemoveButton } from '@/components/removal/RemoveButton'
import { todayLocalIso, frDayMonthLocal } from '@/lib/time/local-date'
import { CLOSURE_REASON_FR, type ClosureReasonKind } from '@/lib/planning/closures'
import { createClosureAction, updateClosureAction, removeClosureAction } from './closures-actions'
import { setSiteFollowsCalendarAction, setSiteFollowsHolidaysAction } from '../../calendrier-scolaire/actions'

export interface ClosureRow {
  id: string
  reasonKind: ClosureReasonKind
  reason: string | null
  startsOn: string
  endsOn: string
  /** Dérivée du calendrier scolaire → la source est le calendrier, pas cette
   *  ligne. On ne la modifie pas ici : on décoche, ou on corrige le calendrier. */
  calendarPeriodId?: string | null
}

const KINDS = Object.entries(CLOSURE_REASON_FR) as Array<[ClosureReasonKind, string]>

/** « 14 juillet » ou « 24 déc. → 2 janv. » — jamais deux fois la même date. */
function periodLabel(startsOn: string, endsOn: string): string {
  const start = frDayMonthLocal(startsOn)
  return startsOn === endsOn ? start : `${start} → ${frDayMonthLocal(endsOn)}`
}

export function SiteClosuresCard({
  siteId,
  closures,
  followsCalendar = false,
  followsHolidays = false,
}: {
  siteId: string
  closures: ClosureRow[]
  /** « Ce chantier ferme pendant les vacances scolaires. » */
  followsCalendar?: boolean
  /** « Ce chantier ferme les jours fériés. » Séparé : un férié ne ferme PAS
   *  tous les sites — le magasin ouvre peut-être le 14 juillet. */
  followsHolidays?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<ClosureRow | 'new' | null>(null)
  const [pendingFollow, startFollow] = useTransition()

  function toggleCalendar(next: boolean) {
    if (pendingFollow) return
    startFollow(async () => {
      const r = await setSiteFollowsCalendarAction(siteId, next)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(
        next
          ? 'Ce chantier ferme pendant les vacances scolaires.'
          : 'Ce chantier ne suit plus le calendrier scolaire.',
      )
      router.refresh()
    })
  }

  function toggleHolidays(next: boolean) {
    if (pendingFollow) return
    startFollow(async () => {
      const r = await setSiteFollowsHolidaysAction(siteId, next)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(
        next ? 'Ce chantier ferme les jours fériés.' : 'Ce chantier ouvre les jours fériés.',
      )
      router.refresh()
    })
  }

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarOff className="h-4 w-4" /> Fermetures
        </h2>
        {editing === null && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        )}
      </header>

      {/* Le calendrier scolaire : un fait d'ORGANISATION appliqué ici. Coché, il
          ferme ce chantier sur toutes les périodes de vacances — sans saisie. */}
      <label className="flex items-start gap-2.5 rounded-xl border bg-muted/20 px-3 py-2.5">
        <input
          type="checkbox"
          checked={followsCalendar}
          onChange={(e) => toggleCalendar(e.target.checked)}
          disabled={pendingFollow}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />
            Ce chantier ferme pendant les vacances scolaires
            {pendingFollow && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </span>
          <span className="block text-xs text-muted-foreground">
            Les périodes se saisissent une fois, dans le{' '}
            <Link href="/fermetures" className="underline underline-offset-2">
              Fermetures
            </Link>
            .
          </span>
        </span>
      </label>

      {/* Les FÉRIÉS, séparément : un jour férié ne ferme PAS tous les sites.
          Le magasin ouvre peut-être le 14 juillet ; l'école, jamais. */}
      <label className="flex items-start gap-2.5 rounded-xl border bg-muted/20 px-3 py-2.5">
        <input
          type="checkbox"
          checked={followsHolidays}
          onChange={(e) => toggleHolidays(e.target.checked)}
          disabled={pendingFollow}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarOff className="h-3.5 w-3.5 text-muted-foreground" />
            Ce chantier ferme les jours fériés
            {pendingFollow && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </span>
          <span className="block text-xs text-muted-foreground">
            Les fériés se saisissent une fois, dans{' '}
            <Link href="/fermetures" className="underline underline-offset-2">
              Fermetures
            </Link>
            .
          </span>
        </span>
      </label>

      {editing !== null && (
        <ClosureForm
          siteId={siteId}
          initial={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null)
            router.refresh()
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {closures.length === 0 && editing === null ? (
        <p className="text-sm text-muted-foreground">
          Aucune fermeture déclarée. Les jours fériés et fermetures du client se déclarent ici.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {closures.map((c) => (
            <li
              key={c.id}
              className="group flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{periodLabel(c.startsOn, c.endsOn)}</p>
                <p className="text-xs text-muted-foreground">
                  {CLOSURE_REASON_FR[c.reasonKind]}
                  {c.reason ? ` · ${c.reason}` : ''}
                </p>
              </div>
              {/* Une fermeture DÉRIVÉE du calendrier ne se modifie pas ici : sa
                  source est le calendrier. On décoche, ou on corrige la période.
                  (Même doctrine que les rythmes d'un roulement.) */}
              {c.calendarPeriodId ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Lock className="h-3 w-3" /> calendrier
                </span>
              ) : (
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEditing(c)}>
                  <Pencil className="h-3.5 w-3.5" /> Modifier
                </Button>
                <RemoveButton
                  label={periodLabel(c.startsOn, c.endsOn)}
                  consequence="Cette fermeture sort de vos écrans. Aucune intervention n’est modifiée."
                  onConfirm={async () => {
                    const r = await removeClosureAction(c.id)
                    return 'error' in r ? { error: r.error } : { ok: true as const }
                  }}
                />
              </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ClosureForm({
  siteId,
  initial,
  onDone,
  onCancel,
}: {
  siteId: string
  initial: ClosureRow | null
  onDone: () => void
  onCancel: () => void
}) {
  const today = todayLocalIso()
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? today)
  // Une fermeture d'un jour est le cas courant : la fin suit le début.
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? today)
  const [reasonKind, setReasonKind] = useState<ClosureReasonKind>(initial?.reasonKind ?? 'holiday')
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [pending, start] = useTransition()

  const invalid = endsOn < startsOn

  function submit() {
    if (invalid || pending) return
    start(async () => {
      const payload = { reasonKind, reason: reason.trim() || undefined, startsOn, endsOn }
      const r = initial
        ? await updateClosureAction({ ...payload, closureId: initial.id })
        : await createClosureAction({ ...payload, siteId })
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(initial ? 'Fermeture modifiée' : 'Fermeture enregistrée')
      onDone()
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Du</span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => {
              setStartsOn(e.target.value)
              // Le cas courant est la fermeture d'un jour : on suit.
              if (endsOn < e.target.value) setEndsOn(e.target.value)
            }}
            disabled={pending}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Raison</span>
        <select
          value={reasonKind}
          onChange={(e) => setReasonKind(e.target.value as ClosureReasonKind)}
          disabled={pending}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Motif (facultatif)</span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="ex : Magasin fermé"
          disabled={pending}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      {invalid && <p className="text-xs text-rose-600">La fin ne peut pas précéder le début.</p>}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={invalid || pending}>
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {initial ? 'Enregistrer' : 'Ajouter'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Annuler
        </Button>
      </div>
    </div>
  )
}
