// AO-1 L2 — Widget Pipeline AO compact, cliquable.
//
// Vincent 2026-05-21 : « compact ; affichage : AO actifs / à rendre cette
// semaine / gagnés ce mois ; cliquable vers /tenders ; pas de kanban dans
// le dashboard ».
//
// 3 compteurs descriptifs. Pas un ranking, pas un score. Silence positif si
// les 3 compteurs sont à zéro (le widget ne s'affiche pas — pas de carte
// vide « tout est calme »).

import Link from 'next/link'
import { ArrowRight, Briefcase } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { AOSnapshot } from '@/lib/db/dashboard'

interface Props {
  snapshot: AOSnapshot
}

export function AOPipelineWidget({ snapshot }: Props) {
  const total = snapshot.activeCount + snapshot.dueSoonCount + snapshot.wonThisMonthCount
  if (total === 0) return null

  return (
    <Card data-slot="ao-pipeline-widget">
      <CardContent className="py-4">
        <Link
          href="/tenders"
          className="flex items-center justify-between gap-4 -m-2 p-2 rounded-md hover:bg-muted/30 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <Briefcase className="h-4 w-4 text-brand-600 shrink-0" strokeWidth={1.75} />
            <h3 className="text-sm font-semibold">Pipeline AO</h3>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
        </Link>
        <dl className="grid grid-cols-3 gap-4 pt-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Actifs</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {snapshot.activeCount.toLocaleString('fr-FR')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">À rendre cette semaine</dt>
            <dd
              className={`text-2xl font-semibold tabular-nums ${
                snapshot.dueSoonCount > 0 ? 'text-red-700 dark:text-red-300' : ''
              }`}
            >
              {snapshot.dueSoonCount.toLocaleString('fr-FR')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Gagnés ce mois</dt>
            <dd
              className={`text-2xl font-semibold tabular-nums ${
                snapshot.wonThisMonthCount > 0 ? 'text-emerald-700 dark:text-emerald-300' : ''
              }`}
            >
              {snapshot.wonThisMonthCount.toLocaleString('fr-FR')}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
