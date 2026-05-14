'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { createInterventionAction } from '../interventions-actions'
import type { DbMission, DbSite, InterventionSlot } from '@/types/db'

interface Props {
  contractId: string
  missions: DbMission[]
  sites: DbSite[]
}

const SLOT_OPTIONS: Array<{ value: InterventionSlot; label: string }> = [
  { value: 'morning', label: 'Matin' },
  { value: 'afternoon', label: 'Après-midi' },
  { value: 'evening', label: 'Soir' },
]

function tomorrowIso(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function CreateInterventionInline({ contractId: _contractId, missions, sites }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [missionId, setMissionId] = useState(missions[0]?.id ?? '')
  const [scheduledFor, setScheduledFor] = useState(tomorrowIso())
  const [slot, setSlot] = useState<InterventionSlot>('afternoon')

  const siteById = new Map(sites.map((s) => [s.id, s]))

  function reset() {
    setMissionId(missions[0]?.id ?? '')
    setScheduledFor(tomorrowIso())
    setSlot('afternoon')
  }

  async function submit() {
    if (!missionId || !scheduledFor) {
      toast.error('Mission et date requises')
      return
    }
    const fd = new FormData()
    fd.set('mission_id', missionId)
    fd.set('scheduled_for', scheduledFor)
    fd.set('slot', slot)
    startTransition(async () => {
      const r = await createInterventionAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Intervention planifiée')
        reset()
        setOpen(false)
        router.refresh()
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
      >
        <Plus className="h-3.5 w-3.5" />
        Planifier une intervention
      </button>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Nouvelle intervention</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          className="p-1 rounded hover:bg-muted/50"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Mission *</label>
        <select
          value={missionId}
          onChange={(e) => setMissionId(e.target.value)}
          disabled={pending}
          className="w-full rounded border p-2 text-sm bg-background"
        >
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {siteById.get(m.site_id)?.name ?? '—'}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Date *</label>
          <input
            type="date"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            disabled={pending}
            className="w-full rounded border p-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Créneau *</label>
          <div
            role="radiogroup"
            aria-label="Créneau"
            className="grid grid-cols-3 gap-1 rounded border p-1 bg-background"
          >
            {SLOT_OPTIONS.map((opt) => {
              const checked = slot === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setSlot(opt.value)}
                  disabled={pending}
                  className={
                    'text-xs rounded px-2 py-1.5 transition-colors ' +
                    (checked
                      ? 'bg-foreground text-background font-medium'
                      : 'hover:bg-muted/50 text-muted-foreground')
                  }
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground italic">
        Créneau nommé (matin/après-midi/soir), pas d&apos;heure précise.
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); reset() }}
          disabled={pending}
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !missionId || !scheduledFor}
          className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
        >
          {pending ? 'Planification...' : 'Planifier'}
        </button>
      </div>
    </div>
  )
}
