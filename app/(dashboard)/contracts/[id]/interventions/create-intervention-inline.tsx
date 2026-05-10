'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { createInterventionAction } from '../interventions-actions'
import type { DbMission, DbSite } from '@/types/db'

interface Props {
  contractId: string
  missions: DbMission[]
  sites: DbSite[]
}

function defaultScheduledAt(): string {
  // Default = tomorrow 08:00 local
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  // datetime-local format : YYYY-MM-DDTHH:mm
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function CreateInterventionInline({ contractId: _contractId, missions, sites }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [missionId, setMissionId] = useState(missions[0]?.id ?? '')
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt())

  const siteById = new Map(sites.map((s) => [s.id, s]))

  function reset() {
    setMissionId(missions[0]?.id ?? '')
    setScheduledAt(defaultScheduledAt())
  }

  async function submit() {
    if (!missionId || !scheduledAt) {
      toast.error('Mission et date requises')
      return
    }
    const fd = new FormData()
    fd.set('mission_id', missionId)
    fd.set('scheduled_at', scheduledAt)
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
        <button type="button" onClick={() => { setOpen(false); reset() }} className="p-1 rounded hover:bg-muted/50" aria-label="Fermer">
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
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Date et heure *</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          disabled={pending}
          className="w-full rounded border p-2 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { setOpen(false); reset() }} disabled={pending} className="px-3 py-1.5 rounded border text-sm disabled:opacity-50">
          Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending || !missionId || !scheduledAt} className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50">
          {pending ? 'Planification...' : 'Planifier'}
        </button>
      </div>
    </div>
  )
}
