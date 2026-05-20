import Link from 'next/link'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AtRiskEngagement } from '@/lib/db/dashboard'

interface Props {
  engagements: AtRiskEngagement[]
}

/**
 * Widget « Engagements à surveiller cette semaine » (Slice 11.2).
 *
 * Affiche les engagements at-risk détectés par getAtRiskEngagements (Slice 11.0).
 * N'apparaît PAS si zéro engagement à risque (silence positif).
 *
 * Doctrine V3 + V6.2 (Vincent 2026-05-20) : focus sur la promesse (engagement),
 * pas sur la personne. ROUGE bordeaux sobre désormais autorisé sur les bandeaux
 * d'alerte qui méritent attention immédiate — cf. [[alertes-doctrine-legere]].
 */
export function AtRiskEngagementsWidget({ engagements }: Props) {
  if (engagements.length === 0) return null

  return (
    <Card
      data-slot="at-risk-engagements"
      className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/40"
    >
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 text-red-900 dark:text-red-100">
          <AlertCircle
            className="h-4 w-4 text-red-700 dark:text-red-300"
            strokeWidth={2}
          />
          <span>Engagements à surveiller cette semaine</span>
          <span className="text-red-900/60 dark:text-red-200/60 font-normal text-xs">
            ({engagements.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-red-200/60 dark:divide-red-900/40">
          {engagements.map((e) => (
            <li key={e.engagement_id} className="px-6 py-3">
              <Link
                href={`/contracts/${e.contract_id}`}
                className="flex items-start gap-3 hover:bg-red-100/50 dark:hover:bg-red-950/40 -mx-6 px-6 py-1 -my-1 transition-colors group"
              >
                <span
                  className="mt-1.5 h-2 w-2 rounded-full bg-red-500 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate text-red-950 dark:text-red-50">
                    {e.short_label}
                  </div>
                  <div className="text-xs text-red-900/70 dark:text-red-200/70 mt-0.5">
                    {e.contract_name} · {e.reasonDetail}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-red-900/60 dark:text-red-200/60 group-hover:text-red-950 dark:group-hover:text-red-50 shrink-0">
                  Voir
                  <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
