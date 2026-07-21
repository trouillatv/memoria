// Liste des visites effectuées sur le site — chaque ligne mène au débrief de la
// visite (/sites/[id]/visites/[visitId]). Lecture seule, rendu serveur.

import Link from 'next/link'
import { ChevronRight, Camera, ListTodo } from 'lucide-react'
import type { VisitWithCounts } from '@/lib/db/visits'
import { NOUMEA_TZ } from '@/lib/time/local-date'

const ORIGIN_LABEL: Record<string, string> = {
  planned: 'Planifiée',
  spontaneous: 'Spontanée',
  qr: 'Visite (QR)',
  gps: 'Sur place',
}

// Le rendu serveur tourne en UTC : une visite commencée à 10 h à Nouméa vaut
// 23 h la VEILLE en UTC. Sans fuseau, la liste date la visite d'un jour trop
// tôt — et rien à l'écran ne le signale.
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDuration(started: string | null, ended: string | null): string | null {
  if (!started || !ended) return null
  const m = Math.max(0, Math.round((new Date(ended).getTime() - new Date(started).getTime()) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export function SiteVisitsList({ siteId, visits }: { siteId: string; visits: VisitWithCounts[] }) {
  if (visits.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Aucune visite enregistrée pour l&apos;instant.</p>
  }

  return (
    <ul className="divide-y">
      {visits.map(({ visit, photos, actions, reserves }) => {
        const duration = fmtDuration(visit.started_at, visit.ended_at)
        return (
          <li key={visit.id}>
            <Link
              href={`/sites/${siteId}/visites/${visit.id}`}
              className="-mx-1 flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-muted/30"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{fmtDate(visit.started_at ?? visit.created_at)}</span>
                  {!visit.ended_at && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      en cours
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {ORIGIN_LABEL[visit.origin ?? ''] ?? 'Visite'}
                  {duration ? ` · ${duration}` : ''}
                  {visit.objective ? ` · ${visit.objective}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {photos > 0 && (
                  <span className="inline-flex items-center gap-1 tabular-nums"><Camera className="h-3.5 w-3.5" />{photos}</span>
                )}
                {actions + reserves > 0 && (
                  <span className="inline-flex items-center gap-1 tabular-nums"><ListTodo className="h-3.5 w-3.5" />{actions + reserves}</span>
                )}
                <ChevronRight className="h-4 w-4" />
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
