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
import { setCalendarEffectAction } from '../../calendrier-scolaire/actions'
import { CALENDAR_EFFECT_FR, type CalendarEffect } from '@/lib/planning/school-calendar'

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
  scolaireEffect = 'none',
  feriesEffect = 'none',
}: {
  siteId: string
  closures: ClosureRow[]
  /** L'EFFET des vacances scolaires sur CE chantier. Le calendrier dit quand ;
   *  le chantier dit quoi : une école ferme, une autre fait justement son grand
   *  nettoyage pendant les vacances, un magasin n'est pas concerné. */
  scolaireEffect?: CalendarEffect
  /** L'effet des jours fériés — même règle, séparément. */
  feriesEffect?: CalendarEffect
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<ClosureRow | 'new' | null>(null)
  const [pendingFollow, startFollow] = useTransition()

  function setEffect(kind: 'scolaire' | 'ferie', effect: CalendarEffect) {
    if (pendingFollow) return
    startFollow(async () => {
      const r = await setCalendarEffectAction(siteId, kind, effect)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(
        effect === 'closed'
          ? 'Fermé pendant la période — les fermetures sont générées.'
          : effect === 'works'
            ? 'Travail prévu pendant la période — aucune fermeture, aucun conflit.'
            : 'Non concerné — les fermetures dérivées sont retirées.',
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

      {/* LE CALENDRIER DIT QUAND ; LE CHANTIER DIT QUOI. Trois règles, pas une
          case : une école ferme pendant les vacances, une autre y fait justement
          son grand nettoyage, un magasin n'est pas concerné. Seul « Fermé »
          produit des fermetures. */}
      <EffectPicker
        label="Pendant les vacances scolaires"
        icon={<GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />}
        value={scolaireEffect}
        pending={pendingFollow}
        onPick={(e) => setEffect('scolaire', e)}
      />
      <EffectPicker
        label="Les jours fériés"
        icon={<CalendarOff className="h-3.5 w-3.5 text-muted-foreground" />}
        value={feriesEffect}
        pending={pendingFollow}
        onPick={(e) => setEffect('ferie', e)}
      />
      <p className="text-[11px] text-muted-foreground">
        Les périodes se saisissent une fois, dans{' '}
        <Link href="/calendrier" className="underline underline-offset-2">
          Calendrier
        </Link>
        . Seul «&nbsp;Fermé&nbsp;» produit des fermetures.
      </p>

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


/** La règle d'un calendrier sur ce chantier — trois choix, un seul actif.
 *  Hors du rendu : recréer un composant à chaque rendu remet l'arbre à zéro. */
function EffectPicker({
  label,
  icon,
  value,
  pending,
  onPick,
}: {
  label: string
  icon: React.ReactNode
  value: CalendarEffect
  pending: boolean
  onPick: (e: CalendarEffect) => void
}) {
  const CHOICES: Array<{ v: CalendarEffect; short: string }> = [
    { v: 'none', short: 'Non concerné' },
    { v: 'closed', short: 'Fermé' },
    { v: 'works', short: 'Travail prévu' },
  ]
  return (
    <div className="space-y-1 rounded-xl border bg-muted/20 px-3 py-2.5">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        {icon} {label}
        {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </span>
      <div className="flex flex-wrap gap-1">
        {CHOICES.map((c) => (
          <button
            key={c.v}
            type="button"
            onClick={() => onPick(c.v)}
            disabled={pending || value === c.v}
            title={CALENDAR_EFFECT_FR[c.v]}
            className={
              value === c.v
                ? 'rounded-lg border border-brand-300 bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-900'
                : 'rounded-lg border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            }
          >
            {c.short}
          </button>
        ))}
      </div>
    </div>
  )
}
