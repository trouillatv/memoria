// Section "Vigilance" en bas de /semaine. Silence positif : la section
// n'apparaît que s'il y a au moins un signal à remonter. Format passif,
// non alarmiste : signal ambre, jamais rouge (doctrine V2).

import Link from 'next/link'
import { AlertTriangle, Users, MapPin } from 'lucide-react'
import type { WeekVigilance } from '@/lib/db/week-vigilance'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'

function formatDateShortFr(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
}

export function WeekVigilanceSection({ data }: { data: WeekVigilance }) {
  const total = data.unassigned.length + data.conflicts.length
  if (total === 0) return null

  return (
    <section
      aria-labelledby="vigilance-heading"
      className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-4"
    >
      <h2
        id="vigilance-heading"
        className="text-sm font-semibold inline-flex items-center gap-2 text-amber-900"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Vigilance ({total})
      </h2>

      {data.unassigned.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-amber-900/80 inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" aria-hidden />
            Sans équipe affectée ({data.unassigned.length})
          </h3>
          <ul className="space-y-1 text-sm">
            {data.unassigned.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3">
                <Link
                  href={`/interventions/${i.id}`}
                  className="hover:underline min-w-0 flex-1 truncate"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {formatDateShortFr(i.scheduled_for)}
                  </span>
                  <span className="text-muted-foreground"> · {formatInterventionTimeLabel({
                    planned_start: i.planned_start,
                    planned_end: i.planned_end,
                    slot: i.slot,
                  })}</span>
                  <span> — </span>
                  <span className="font-medium">{i.site_name}</span>
                  <span className="text-muted-foreground"> ({i.mission_name})</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.conflicts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-amber-900/80 inline-flex items-center gap-1.5">
            <Users className="h-3 w-3" aria-hidden />
            Équipes sur plusieurs sites sur des horaires qui chevauchent ({data.conflicts.length})
          </h3>
          <ul className="space-y-1 text-sm">
            {data.conflicts.map((c, idx) => (
              <li key={`${c.team_id}-${c.scheduled_for}-${c.slot}-${idx}`}>
                <span className="text-muted-foreground tabular-nums">
                  {formatDateShortFr(c.scheduled_for)} · {formatInterventionTimeLabel({
                    planned_start: c.planned_start,
                    planned_end: c.planned_end,
                    slot: c.slot,
                  })}
                </span>
                <span> — </span>
                <span className="font-medium">{c.team_name}</span>
                <span className="text-muted-foreground"> : {c.site_names.join(', ')}</span>
                <span className="text-[10px] text-muted-foreground ml-2">
                  (
                  {c.intervention_ids.map((id, i) => (
                    <span key={id}>
                      <Link href={`/interventions/${id}`} className="underline hover:text-foreground">
                        interv. {i + 1}
                      </Link>
                      {i < c.intervention_ids.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                  )
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
