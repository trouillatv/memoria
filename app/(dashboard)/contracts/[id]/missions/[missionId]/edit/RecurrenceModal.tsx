'use client'

// Phase 6 — Recurrence simple — Slice 6.2
//
// Modal de creation d'une recurrence depuis une mission. 4 questions max,
// francais parle. Doctrine UX :
//   - Wording "recurrence" (jamais "template", jamais "planning")
//   - Creneaux nommes (Matin / Apres-midi / Soir), jamais d'horaires precis
//   - Pas d'agent, pas de roulement, pas de preview calendrier

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { createRecurrenceAction, type CreateRecurrenceInput } from '../../../recurrences-actions'
import type { InterventionFrequency, InterventionSlot } from '@/types/db'

interface RecurrenceModalProps {
  missionId: string
  missionName: string
  contractId: string
  open: boolean
  onClose: () => void
}

const FREQUENCY_OPTIONS: { value: InterventionFrequency; label: string }[] = [
  { value: 'daily', label: 'Tous les jours' },
  { value: 'weekdays', label: 'Du lundi au vendredi' },
  { value: 'weekly', label: 'Une fois par semaine' },
  { value: 'monthly', label: 'Une fois par mois' },
]

const DAY_OF_WEEK_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' },
]

const SLOT_OPTIONS: { value: InterventionSlot; label: string }[] = [
  { value: 'morning', label: 'Matin' },
  { value: 'afternoon', label: 'Après-midi' },
  { value: 'evening', label: 'Soir' },
]

function todayIso(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function RecurrenceModal({
  missionId,
  missionName,
  contractId,
  open,
  onClose,
}: RecurrenceModalProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [frequency, setFrequency] = useState<InterventionFrequency>('daily')
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(null)
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(null)
  const [slots, setSlots] = useState<Set<InterventionSlot>>(new Set())
  const [startsOn, setStartsOn] = useState<string>(todayIso())
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  function toggleSlot(s: InterventionSlot) {
    setSlots((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function reset() {
    setFrequency('daily')
    setDayOfWeek(null)
    setDayOfMonth(null)
    setSlots(new Set())
    setStartsOn(todayIso())
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  const isValid =
    !!startsOn &&
    (frequency !== 'weekly' || dayOfWeek !== null) &&
    (frequency !== 'monthly' || (dayOfMonth !== null && dayOfMonth >= 1 && dayOfMonth <= 28))

  async function submit() {
    setError(null)
    if (!isValid) return

    const payload: CreateRecurrenceInput = {
      mission_id: missionId,
      contract_id: contractId,
      frequency,
      day_of_week: frequency === 'weekly' ? dayOfWeek : null,
      day_of_month: frequency === 'monthly' ? dayOfMonth : null,
      slots: Array.from(slots),
      starts_on: startsOn,
    }

    startTransition(async () => {
      const r = await createRecurrenceAction(payload)
      if (!r.ok) {
        setError(r.error)
        toast.error(r.error)
        return
      }
      toast.success('Récurrence créée')
      close()
      router.refresh()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recurrence-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="recurrence-modal-title" className="text-lg font-semibold">
              Quand cette mission revient-elle ?
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mission : <span className="font-medium text-foreground">{missionName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={pending}
            aria-label="Fermer"
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Q2 — Elle revient quand ? */}
        <fieldset className="space-y-2" data-testid="q-frequency">
          <legend className="text-sm font-medium">Elle revient quand ?</legend>
          <div className="space-y-1.5">
            {FREQUENCY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 p-2 rounded border bg-background hover:bg-muted/30 cursor-pointer"
              >
                <input
                  type="radio"
                  name="frequency"
                  value={opt.value}
                  checked={frequency === opt.value}
                  onChange={() => {
                    setFrequency(opt.value)
                    if (opt.value !== 'weekly') setDayOfWeek(null)
                    if (opt.value !== 'monthly') setDayOfMonth(null)
                  }}
                  disabled={pending}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>

          {frequency === 'weekly' && (
            <div className="pl-2 pt-1 space-y-1.5" data-testid="q-day-of-week">
              <label className="text-xs text-muted-foreground">Quel jour ?</label>
              <select
                value={dayOfWeek ?? ''}
                onChange={(e) => setDayOfWeek(e.target.value ? Number(e.target.value) : null)}
                disabled={pending}
                className="w-full rounded border p-2 text-sm bg-background"
              >
                <option value="">— Choisir —</option>
                {DAY_OF_WEEK_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {frequency === 'monthly' && (
            <div className="pl-2 pt-1 space-y-1.5" data-testid="q-day-of-month">
              <label className="text-xs text-muted-foreground">Quel jour du mois ?</label>
              <input
                type="number"
                min={1}
                max={28}
                value={dayOfMonth ?? ''}
                onChange={(e) => setDayOfMonth(e.target.value ? Number(e.target.value) : null)}
                disabled={pending}
                placeholder="1 à 28"
                className="w-full rounded border p-2 text-sm bg-background"
              />
              <p className="text-[11px] text-muted-foreground">
                Limite à 28 pour couvrir tous les mois sans exception.
              </p>
            </div>
          )}
        </fieldset>

        {/* Q3 — A quel moment de la journee ? */}
        <fieldset className="space-y-2" data-testid="q-slots">
          <legend className="text-sm font-medium">À quel moment de la journée ?</legend>
          <p className="text-[11px] text-muted-foreground">
            Optionnel — laissez vide pour une intervention par jour.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {SLOT_OPTIONS.map((s) => {
              const selected = slots.has(s.value)
              return (
                <button
                  key={s.value}
                  type="button"
                  data-testid={`slot-chip-${s.value}`}
                  aria-pressed={selected}
                  onClick={() => toggleSlot(s.value)}
                  disabled={pending}
                  className={
                    selected
                      ? 'inline-flex items-center px-3 py-1.5 rounded-full border text-xs font-medium bg-foreground text-background border-foreground'
                      : 'inline-flex items-center px-3 py-1.5 rounded-full border text-xs font-medium bg-background hover:bg-muted/50'
                  }
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        {/* Q4 — A partir de quand ? */}
        <div className="space-y-1.5" data-testid="q-starts-on">
          <label className="text-sm font-medium" htmlFor="starts-on">
            À partir de quand ?
          </label>
          <input
            id="starts-on"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            disabled={pending}
            className="w-full rounded border p-2 text-sm bg-background"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !isValid}
            data-testid="recurrence-submit"
            className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
          >
            {pending ? 'Création…' : 'Créer la récurrence'}
          </button>
        </div>
      </div>
    </div>
  )
}
