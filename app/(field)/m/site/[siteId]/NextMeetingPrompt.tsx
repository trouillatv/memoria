'use client'

// « On se revoit mardi à 9h. » — la phrase qui clôt presque toutes les réunions
// de chantier, et que l'application n'entendait jamais. Posée UNE fois, à la fin
// de la réunion, facultative, jamais bloquante. La date écrite alimente tout ce
// qui existe déjà : bloc « Prochaine étape » de la fiche, planning, briefs.

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
    const iso = new Date(value).toISOString()
    start(async () => {
      const r = await setNextMeetingAction({ report_id: reportId, at: iso })
      if (r.ok) {
        setSaved(value)
        toast.success('Prochaine réunion programmée', { duration: 1500 })
      } else toast.error(r.error)
    })
  }

  if (saved) {
    const d = new Date(saved)
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
        <Check className="h-4 w-4" />
        Réunion programmée — {d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        {' à '}
        {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}
      </p>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-left">
      <p className="inline-flex items-center gap-1.5 text-sm font-medium">
        <CalendarClock className="h-4 w-4 text-sky-600" /> Prochaine réunion ?
      </p>
      <p className="text-xs text-muted-foreground">
        « On se revoit… » — programmez-la maintenant, elle apparaîtra sur le chantier et au planning.
      </p>
      <div className="flex gap-2">
        <input
          type="datetime-local"
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
