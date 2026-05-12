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
 * Doctrine V3 : focus sur la promesse (engagement), pas sur la personne.
 * Sobriété calme : ambre / muted, jamais d'alarme rouge.
 */
export function AtRiskEngagementsWidget({ engagements }: Props) {
  if (engagements.length === 0) return null

  return (
    <Card data-slot="at-risk-engagements">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600" strokeWidth={1.75} />
          <span>Engagements à surveiller cette semaine</span>
          <span className="text-muted-foreground font-normal text-xs">({engagements.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {engagements.map((e) => (
            <li key={e.engagement_id} className="px-6 py-3">
              <Link
                href={`/contracts/${e.contract_id}`}
                className="flex items-start gap-3 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
              >
                <span
                  className="mt-1.5 h-2 w-2 rounded-full bg-amber-400 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{e.short_label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {e.contract_name} · {e.reasonDetail}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground shrink-0">
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
