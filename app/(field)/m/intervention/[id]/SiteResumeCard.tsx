// Sprint 2 — Mode "Reprise du site" (doctrine V5).
//
// Encart affiché AU-DESSUS de la section "À savoir" quand :
//   - daysSinceLastVisit > 7 jours (l'user revient après absence)
//   - ou daysSinceLastVisit === null (premier passage de ce user sur ce site)
//
// Wording strictement factuel passif :
//   ✅ « Reprise — dernier passage il y a N jours »
//   ✅ « Premier passage sur ce site »
//   ✅ « Notes récentes » / « Anomalies des 30 derniers jours »
//   ❌ « Attention à... », « Pense à... » (verrou V4)

import { Clock } from 'lucide-react'
import type { SiteResumeContext } from '@/lib/db/interventions'
import { AddSiteNoteButton } from './AddSiteNoteButton'

interface Props {
  siteId: string
  context: SiteResumeContext
}

export function SiteResumeCard({ siteId, context }: Props) {
  const isFirstVisit = context.daysSinceLastVisit === null
  const title = isFirstVisit
    ? 'Premier passage sur ce site'
    : `Reprise — dernier passage il y a ${context.daysSinceLastVisit} jours`

  const hasNotes = context.recentSiteNotes.length > 0
  const hasAnomalies = context.recentAnomalies.length > 0

  return (
    <section
      data-testid="site-resume-card"
      aria-labelledby="site-resume-heading"
      className="rounded-lg border bg-sky-50/40 border-sky-200 p-3"
    >
      <h2
        id="site-resume-heading"
        className="text-sm font-semibold text-sky-900 mb-2 flex items-center gap-2"
      >
        <Clock className="h-4 w-4" />
        {title}
      </h2>

      {hasNotes && (
        <div className="mb-2">
          <div className="text-xs text-muted-foreground mb-1">Notes récentes</div>
          <ul className="space-y-1 text-sm">
            {context.recentSiteNotes.slice(0, 3).map((n) => (
              <li key={n.id}>• {n.body}</li>
            ))}
          </ul>
        </div>
      )}

      {hasAnomalies && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">
            Anomalies des 30 derniers jours
          </div>
          <ul className="space-y-1 text-sm">
            {context.recentAnomalies.slice(0, 3).map((a) => (
              <li key={a.id}>
                • {a.description}
                {a.resolved_at && (
                  <span className="text-[10px] text-emerald-700 ml-1">
                    (clôturée)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddSiteNoteButton siteId={siteId} />
    </section>
  )
}
