// Sprint 4.5 — « Engagements à suivre » (présentationnel).
//
// Coordination, PAS évaluation. Tri alphabétique (jamais par volume), wording
// neutre, aucun score / % / classement / « performance ». Bucket « Sans
// responsable » en tête (appel à coordination). Tout responsable est affiché
// (interne ou externe) comme un point de coordination, pas un indicateur
// individuel.

import Link from 'next/link'
import { Users, UserX, AlertTriangle } from 'lucide-react'
import type { SiteEngagements } from '@/lib/db/site-engagements'

export function EngagementsTable({ data, reportId }: { data: SiteEngagements; reportId: string }) {
  if (data.responsables.length === 0 && data.sansResponsable === 0) return null

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-muted-foreground" /> Engagements à suivre
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Quelles responsabilités restent à suivre avant la prochaine réunion.
        </p>
      </div>

      {/* Sans responsable — en tête, c'est un point de coordination à corriger. */}
      {data.sansResponsable > 0 && (
        <Link
          href={`/meetings/${reportId}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm"
        >
          <span className="inline-flex items-center gap-2 font-medium text-amber-900">
            <UserX className="h-4 w-4 text-amber-600" /> Sans responsable
          </span>
          <span className="tabular-nums text-amber-800">{data.sansResponsable} à attribuer</span>
        </Link>
      )}

      {data.responsables.length > 0 && (
        <ul className="divide-y">
          {data.responsables.map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{g.label}</span>
              <span className="shrink-0 inline-flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                <span>{g.ouvertes} à suivre</span>
                {g.enRetard > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                    <AlertTriangle className="h-3 w-3" /> {g.enRetard} en retard
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
