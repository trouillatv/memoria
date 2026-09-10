import Link from 'next/link'
import { Clock } from 'lucide-react'
import { sliceOverview } from '@/lib/knowledge/overview-counter'
import type { LingeringPointEntry } from '@/lib/knowledge/tracked-point-lingering'

// ── LOT 2 « Aujourd'hui » — Bloc 3 « Points qui traînent » ──
//
// Présentation pure de `selectLingeringPoints` (lib/knowledge/tracked-point-lingering.ts).
// Chaque ligne ouvre directement la fiche du Point (jamais le sujet) : c'est le Point qui
// traîne, la destination doit être la preuve elle-même.

const CAP = 5

export function SiteLingeringPointsBlock({
  entries,
  seeAllHref,
  pointHrefPrefix,
}: {
  entries: LingeringPointEntry[]
  seeAllHref: string
  /** Préfixe de fiche Point (`/sites/<id>/point` ou `/m/site/<siteId>/point`). */
  pointHrefPrefix: string
}) {
  const { shown, total, hiddenCount } = sliceOverview(entries, CAP)

  if (total === 0) {
    return (
      <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
        Aucun Point ne traîne sans évolution sur ce chantier.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {shown.map((p) => (
          <li key={p.id}>
            <Link
              href={`${pointHrefPrefix}/${p.id}`}
              className="group flex items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/50"
            >
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug text-foreground">{p.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {`Sans évolution depuis ${p.daysSinceLastEvent} j`}
                  {` · ${p.passagesSinceEvent} passage${p.passagesSinceEvent > 1 ? 's' : ''} sans changement`}
                  {p.derivedState === 'reopened' ? ' · Réouvert' : ''}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <Link href={seeAllHref} className="inline-block pl-1 text-xs font-medium text-primary hover:underline">
          +{hiddenCount} autre{hiddenCount > 1 ? 's' : ''} · Voir tous les Points
        </Link>
      )}
    </div>
  )
}
