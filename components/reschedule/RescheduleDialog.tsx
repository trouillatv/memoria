'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock } from 'lucide-react'

const SLOT_LABELS: Record<string, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
}

const SLOT_BADGE: Record<string, string> = {
  morning: 'bg-amber-50 border-amber-200 text-amber-900',
  afternoon: 'bg-sky-50 border-sky-200 text-sky-900',
  evening: 'bg-indigo-50 border-indigo-200 text-indigo-900',
}

const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

// Date civile (yyyy-mm-dd) d'un instant en zone Nouméa — évite le bug UTC
// (en Nouméa pendant la journée locale, toISOString().slice(0,10) retourne
// la date UTC qui est "hier" pendant les 11 premières heures locales).
const NOUMEA_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit',
})

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const todayStr = NOUMEA_FORMATTER.format(new Date())
  const tomorrowStr = addDaysIso(todayStr, 1)
  if (dateStr === todayStr) return "Aujourd'hui"
  if (dateStr === tomorrowStr) return 'Demain'
  return `${FR_DAYS[date.getUTCDay()]} ${date.getUTCDate()}`
}

type Slot = { date: string; slot: 'morning' | 'afternoon' | 'evening' }

interface Props {
  interventionId: string
  open: boolean
  onClose: () => void
  fetchSlots: (interventionId: string) => Promise<{ ok: true; slots: Slot[] } | { ok?: false; error: string } | { error: string }>
  reschedule: (fd: FormData) => Promise<{ ok: true } | { error: string }>
  /** Variant compact pour mobile (boutons plus gros, tap-friendly). */
  variant?: 'desktop' | 'mobile'
}

export function RescheduleDialog({ interventionId, open, onClose, fetchSlots, reschedule, variant = 'desktop' }: Props) {
  const router = useRouter()
  const overlayRef = useRef<HTMLDivElement>(null)
  const [pending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [picked, setPicked] = useState<Slot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSlots(null)
    setPicked(null)
    setError(null)
    setLoading(true)
    fetchSlots(interventionId).then((r) => {
      if ('ok' in r && r.ok) setSlots(r.slots)
      else if ('error' in r) setError(r.error)
      setLoading(false)
    })
  }, [open, interventionId, fetchSlots])

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current && !pending) onClose()
  }

  function submit() {
    if (!picked) return
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('new_date', picked.date)
    fd.set('new_slot', picked.slot)
    setError(null)
    startTransition(async () => {
      const r = await reschedule(fd)
      if ('error' in r && r.error) {
        setError(r.error)
        return
      }
      onClose()
      router.refresh()
    })
  }

  if (!open) return null

  // Grouper les slots par date
  const slotsByDay = new Map<string, Slot[]>()
  for (const s of slots ?? []) {
    const list = slotsByDay.get(s.date) ?? []
    list.push(s)
    slotsByDay.set(s.date, list)
  }

  const isMobile = variant === 'mobile'

  return (
    <div
      ref={overlayRef}
      role="presentation"
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-title"
        className="w-full sm:max-w-md bg-background rounded-t-2xl sm:rounded-2xl shadow-lg border-t sm:border max-h-[85vh] overflow-y-auto"
      >
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <h2 id="reschedule-title" className="text-lg font-semibold inline-flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Décaler l&apos;intervention
            </h2>
            <p className="text-sm text-muted-foreground">
              Créneaux libres pour cette équipe sur les 7 prochains jours.
            </p>
          </div>

          {loading && (
            <p className="text-sm text-muted-foreground">Recherche des créneaux libres…</p>
          )}

          {!loading && slots && slots.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              Aucun créneau libre pour cette équipe sur les 7 prochains jours.
            </p>
          )}

          {!loading && slots && slots.length > 0 && (
            <div className="space-y-3">
              {Array.from(slotsByDay.entries()).map(([date, daySlots]) => (
                <div key={date}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    {formatDayLabel(date)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {daySlots.map((s) => {
                      const isPicked = picked?.date === s.date && picked?.slot === s.slot
                      return (
                        <button
                          key={`${s.date}-${s.slot}`}
                          type="button"
                          onClick={() => setPicked(s)}
                          disabled={pending}
                          className={`inline-flex items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                            isMobile ? 'py-2 text-sm' : 'py-1'
                          } ${
                            isPicked
                              ? 'bg-foreground text-background border-foreground'
                              : `${SLOT_BADGE[s.slot]} hover:opacity-80`
                          }`}
                        >
                          {SLOT_LABELS[s.slot]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className={`inline-flex items-center justify-center rounded-xl border border-border bg-card font-medium px-4 ${
                isMobile ? 'py-3 text-base min-h-[48px]' : 'py-2 text-sm'
              } active:bg-muted/40 disabled:opacity-50`}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !picked}
              className={`inline-flex items-center justify-center rounded-xl bg-foreground text-background font-medium px-4 ${
                isMobile ? 'py-3 text-base min-h-[48px]' : 'py-2 text-sm'
              } active:bg-foreground/90 disabled:opacity-50`}
            >
              {pending ? 'Décalage…' : 'Confirmer le décalage'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
