'use client'

// Phase 6 — Recurrence simple — Slice 6.2 + 6.5
//
// Modal de creation OU edition d'une recurrence depuis une mission. 4 questions
// max, francais parle. Doctrine UX :
//   - Wording "recurrence" (jamais "template", jamais "planning")
//   - Creneaux HORAIRES (heure de debut / fin), jamais "Matin / Apres-midi /
//     Soir" cote UI (decision Vincent 2026-06-15 — voir 10_JOURNAL_DECISIONS)
//   - Pas d'agent, pas de roulement, pas de preview calendrier
//
// Mode :
//   - prop `template` absente → creation
//   - prop `template` presente → edition (prerempli, titre adapte, action update)

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import {
  createRecurrenceAction,
  updateRecurrenceAction,
  type CreateRecurrenceInput,
  type UpdateRecurrenceInput,
} from '../../../recurrences-actions'
import type {
  DbInterventionTemplate,
  InterventionFrequency,
} from '@/types/db'

interface RecurrenceModalProps {
  missionId: string
  missionName: string
  contractId: string
  open: boolean
  onClose: () => void
  /** Mode edition si fourni, mode creation sinon. */
  template?: DbInterventionTemplate | null
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
  template,
}: RecurrenceModalProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const isEdit = !!template

  // Valeurs initiales — derives du template en mode edition, defaults sinon.
  const initialFrequency: InterventionFrequency =
    template?.frequency && template.frequency !== 'one_shot'
      ? template.frequency
      : (template?.frequency ?? 'daily')
  const initialDayOfWeek = template?.day_of_week ?? null
  const initialDayOfMonth = template?.day_of_month ?? null
  const initialStart = template?.planned_start_hhmm ?? ''
  const initialEnd = template?.planned_end_hhmm ?? ''
  const initialStartsOn = template?.starts_on ?? todayIso()

  const [frequency, setFrequency] = useState<InterventionFrequency>(initialFrequency)
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(initialDayOfWeek)
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(initialDayOfMonth)
  const [startTime, setStartTime] = useState<string>(initialStart)
  const [endTime, setEndTime] = useState<string>(initialEnd)
  const [startsOn, setStartsOn] = useState<string>(initialStartsOn)
  const [error, setError] = useState<string | null>(null)

  // Resync quand template change (passage d'un template à un autre sans démontage)
  useEffect(() => {
    if (!open) return
    if (template) {
      setFrequency(template.frequency)
      setDayOfWeek(template.day_of_week ?? null)
      setDayOfMonth(template.day_of_month ?? null)
      setStartTime(template.planned_start_hhmm ?? '')
      setEndTime(template.planned_end_hhmm ?? '')
      setStartsOn(template.starts_on)
      setError(null)
    } else {
      setFrequency('daily')
      setDayOfWeek(null)
      setDayOfMonth(null)
      setStartTime('')
      setEndTime('')
      setStartsOn(todayIso())
      setError(null)
    }
  }, [open, template])

  if (!open) return null

  function reset() {
    if (!template) {
      setFrequency('daily')
      setDayOfWeek(null)
      setDayOfMonth(null)
      setStartTime('')
      setEndTime('')
      setStartsOn(todayIso())
    }
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
  const isValid =
    !!startsOn &&
    HHMM.test(startTime) &&
    HHMM.test(endTime) &&
    startTime < endTime &&
    (frequency !== 'weekly' || dayOfWeek !== null) &&
    (frequency !== 'monthly' || (dayOfMonth !== null && dayOfMonth >= 1 && dayOfMonth <= 28))

  async function submit() {
    setError(null)
    if (!isValid) return

    if (isEdit && template) {
      const payload: UpdateRecurrenceInput = {
        templateId: template.id,
        contract_id: contractId,
        frequency,
        day_of_week: frequency === 'weekly' ? dayOfWeek : null,
        day_of_month: frequency === 'monthly' ? dayOfMonth : null,
        slots: [],
        planned_start_hhmm: startTime,
        planned_end_hhmm: endTime,
        starts_on: startsOn,
      }
      startTransition(async () => {
        const r = await updateRecurrenceAction(payload)
        if (!r.ok) {
          setError(r.error)
          toast.error(r.error)
          return
        }
        toast.success('Récurrence modifiée')
        close()
        router.refresh()
      })
      return
    }

    const payload: CreateRecurrenceInput = {
      mission_id: missionId,
      contract_id: contractId,
      frequency,
      day_of_week: frequency === 'weekly' ? dayOfWeek : null,
      day_of_month: frequency === 'monthly' ? dayOfMonth : null,
      slots: [],
      planned_start_hhmm: startTime,
      planned_end_hhmm: endTime,
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

  const modalTitle = isEdit ? 'Modifier la récurrence' : 'Quand cette mission revient-elle ?'
  const submitLabel = pending
    ? isEdit ? 'Enregistrement…' : 'Création…'
    : isEdit ? 'Enregistrer les modifications' : 'Créer la récurrence'

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
              {modalTitle}
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

        {/* Q3 — À quelle heure ? (début + fin obligatoires, plus de créneaux) */}
        <fieldset className="space-y-2" data-testid="q-time">
          <legend className="text-sm font-medium">À quelle heure ?</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="rec-start" className="text-xs text-muted-foreground">Début</label>
              <input
                id="rec-start"
                type="time"
                step={300}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={pending}
                className="w-full rounded border p-2 text-sm bg-background"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="rec-end" className="text-xs text-muted-foreground">Fin</label>
              <input
                id="rec-end"
                type="time"
                step={300}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={pending}
                className="w-full rounded border p-2 text-sm bg-background"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Chaque occurrence sera planifiée à cette heure précise.
          </p>
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
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
