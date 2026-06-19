// Sprint 3 — Bloc « Suivi de la réunion précédente » (présentationnel).
// Données 100% déterministes (cf. getMeetingFollowup) : aucune interprétation.

import { CheckCircle2, CircleDot, AlertTriangle, UserX } from 'lucide-react'
import type { MeetingFollowup as Followup } from '@/lib/db/meeting-followup'

const STATS = [
  { key: 'closed', label: 'Clôturées', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
  { key: 'open', label: 'Ouvertes', icon: CircleDot, tone: 'text-sky-600 bg-sky-50' },
  { key: 'overdue', label: 'En retard', icon: AlertTriangle, tone: 'text-rose-600 bg-rose-50' },
  { key: 'withoutOwner', label: 'Sans responsable', icon: UserX, tone: 'text-amber-600 bg-amber-50' },
] as const

export function MeetingFollowup({ data }: { data: Followup }) {
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">Suivi de la réunion précédente</h2>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STATS.map((s) => {
          const Icon = s.icon
          const value = data[s.key]
          return (
            <div key={s.key} className="rounded-lg border bg-background p-3">
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${s.tone}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="mt-1.5 text-xl font-semibold tabular-nums">{value}</div>
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
            </div>
          )
        })}
      </div>

      {data.criticalPoints.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Points critiques</p>
          <ul className="space-y-1">
            {data.criticalPoints.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                <span><span className="font-medium">{p.label}</span> — <span className="text-muted-foreground">{p.detail}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!data.hasPrevious && (
        <p className="text-xs text-muted-foreground italic">Première réunion du site — pas d&apos;historique antérieur.</p>
      )}
    </section>
  )
}
