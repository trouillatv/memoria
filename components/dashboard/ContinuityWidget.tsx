// Sprint E — Widget dashboard compact pour la continuité.
//
// Vincent 2026-05-22. Affiche "N passations à préparer" si > 0, sinon rien
// (silence positif).
//
// Server component, gated par CONTINUITY_PAGE_ENABLED.

import Link from 'next/link'
import { ArrowRightLeft, ChevronRight } from 'lucide-react'
import { listContinuityRisks } from '@/lib/db/continuity'
import { isContinuityFeatureEnabled } from '@/lib/continuity/access'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export async function ContinuityWidget() {
  if (!isContinuityFeatureEnabled()) return null
  const viewer = await getCurrentUserWithProfile()
  if (!viewer) return null
  if (viewer.role !== 'admin' && viewer.role !== 'manager') return null

  const risks = await listContinuityRisks({ horizonDays: 30, viewerUserId: viewer.id })
  const total = risks.entries.length
  if (total === 0) return null // silence positif

  const urgentCount = risks.counts.j7
  const accentColor = urgentCount > 0
    ? 'border-rose-300 bg-rose-50/40 dark:bg-rose-950/20'
    : risks.counts.j14 > 0
      ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20'
      : 'border-border bg-muted/30'

  return (
    <Link
      href="/continuite"
      className={`block rounded-lg border-2 ${accentColor} px-4 py-3 hover:bg-muted/40 transition-colors`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <ArrowRightLeft className="h-5 w-5 text-brand-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {total} passation{total > 1 ? 's' : ''} à préparer
            </p>
            <p className="text-xs text-muted-foreground">
              {urgentCount > 0 && (
                <span className="text-rose-700 dark:text-rose-300 font-medium">
                  {urgentCount} ≤ 7 jours
                </span>
              )}
              {urgentCount > 0 && risks.counts.j14 > 0 && ' · '}
              {risks.counts.j14 > 0 && (
                <span>{risks.counts.j14} dans 2 semaines</span>
              )}
              {(urgentCount > 0 || risks.counts.j14 > 0) && risks.counts.j30 > 0 && ' · '}
              {risks.counts.j30 > 0 && (
                <span>{risks.counts.j30} dans 1 mois</span>
              )}
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
  )
}
