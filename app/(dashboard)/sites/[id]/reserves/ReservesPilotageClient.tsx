'use client'

// V1-3 — vue « Réserves à piloter » desktop : hiérarchie SUJET → réserve durable (CBO) → occurrences.
// Consomme getSiteReservesPilotage (identité durable) et RÉUTILISE `ReservesView` par groupe pour N3 —
// le mini-dossier (photos avant/après, actions correctives, documents, gestes lever/lier) est préservé
// INTÉGRALEMENT, jamais refactoré. AUCUN état durable réserve n'est affiché (pas de lifecycle) : les
// occurrences (N occurrences / N PV) et leurs statuts BRUTS restent au niveau occurrence.

import { ChevronRight } from 'lucide-react'
import { ReservesView, type ReserveWithPhotos } from './ReservesView'
import type { ReservePilotageSubject } from '@/lib/knowledge/reserves-pilotage'

export function ReservesPilotageClient({
  siteId,
  subjects,
  reserves,
  siteDocuments,
}: {
  siteId: string
  subjects: ReservePilotageSubject[]
  reserves: ReserveWithPhotos[]
  siteDocuments: { id: string; filename: string }[]
}) {
  const byId = new Map(reserves.map((r) => [r.id, r]))

  if (subjects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-6 text-center">
        Aucune réserve suivie sur ce chantier pour le moment.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {subjects.map((s) => (
        <li key={s.canonicalSubjectId} className="rounded-xl border">
          <details className="group/subj" open={subjects.length === 1}>
            <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 select-none hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">{s.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {s.occurrenceCount} occurrence{s.occurrenceCount > 1 ? 's' : ''} documentaire{s.occurrenceCount > 1 ? 's' : ''}
                  {s.pvCount > 0 && ` · ${s.pvCount} PV`}
                </p>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/subj:rotate-90" />
            </summary>
            <div className="border-t px-3 py-2.5 space-y-4">
              {s.reserves.map((r) => {
                const occ = r.occurrenceIds.map((id) => byId.get(id)).filter((x): x is ReserveWithPhotos => !!x)
                return (
                  <div key={r.cboId}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Réserve · {r.occurrenceCount} occurrence{r.occurrenceCount > 1 ? 's' : ''}
                      {r.pvCount > 0 && ` dans ${r.pvCount} PV`}
                    </p>
                    {/* N3 — dossier documentaire complet (mini-dossier préservé). */}
                    <ReservesView siteId={siteId} reserves={occ} siteDocuments={siteDocuments} />
                  </div>
                )
              })}
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}
