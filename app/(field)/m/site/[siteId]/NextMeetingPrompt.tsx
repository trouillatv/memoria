'use client'

// « On se revoit mardi. » — la phrase qui clôt presque toutes les réunions
// de chantier, et que l'application n'entendait jamais. Posée UNE fois, à la fin
// de la réunion, facultative, jamais bloquante. Le JOUR écrit alimente tout ce
// qui existe déjà : agenda du chantier, planning, briefs.
// SCHÉMA : site_reports.next_meeting_at est une DATE (mig 131) — on programme
// le jour, pas l'heure. L'heure viendra avec une migration timestamptz dédiée.

import { useState, useTransition } from 'react'
import { CalendarClock, Check } from 'lucide-react'
import { toast } from 'sonner'
import { setNextMeetingAction } from './report-actions'

export function NextMeetingPrompt({ reportId }: { reportId: string }) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save() {
    if (!value) return
    start(async () => {
      // `value` est déjà le jour civil choisi (YYYY-MM-DD) — aucun fuseau en jeu.
      const r = await setNextMeetingAction({ report_id: reportId, at: value })
      if (r.ok) {
        setSaved(value)
        toast.success('Prochaine réunion programmée', { duration: 1500 })
      } else toast.error(r.error)
    })
  }

  if (saved) {
    const d = new Date(`${saved}T00:00:00`)
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
        <Check className="h-4 w-4" />
        Réunion programmée — {d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-left">
      <p className="inline-flex items-center gap-1.5 text-sm font-medium">
        <CalendarClock className="h-4 w-4 text-sky-600" /> Prochaine réunion ?
      </p>
      <p className="text-xs text-muted-foreground">
        « On se revoit… » — notez le jour, il apparaîtra sur le chantier et au planning.
      </p>
      <div className="flex gap-2">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={save}
          disabled={!value || pending}
          className="shrink-0 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          Programmer
        </button>
      </div>
    </div>
  )
}
