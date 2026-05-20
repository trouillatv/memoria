import Link from 'next/link'
import { TrendingDown, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ContractUnderTension } from '@/lib/db/dashboard'

interface Props {
  contracts: ContractUnderTension[]
}

/**
 * Widget « Contrats sous tension » (Slice 11.3).
 *
 * Liste les contrats dont la boucle de preuve faiblit
 * (globalScore < 0.7 ou un segment < 0.5) sur les 30 derniers jours.
 *
 * SegmentBar visualise les 5 segments PROMIS/PLANIFIÉ/EXÉCUTÉ/PROUVÉ/VALIDÉ
 * en mini-barres ambre (segment < 0.5) ou emerald (>= 0.5).
 *
 * N'apparaît PAS si zéro contrat sous tension (silence positif).
 * Doctrine V3 : focus sur le contrat (boucle), aucune mention humaine.
 */
export function ContractsUnderTensionWidget({ contracts }: Props) {
  if (contracts.length === 0) return null

  // V6.2 (Vincent 2026-05-20) : bandeau ROUGE bordeaux, en haut du dashboard.
  // Silence positif si zéro contrat sous tension.
  return (
    <Card
      data-slot="contracts-under-tension"
      className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/40"
    >
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 text-red-900 dark:text-red-100">
          <TrendingDown
            className="h-4 w-4 text-red-700 dark:text-red-300"
            strokeWidth={2}
          />
          <span>Contrats sous tension</span>
          <span className="text-red-900/60 dark:text-red-200/60 font-normal text-xs">
            ({contracts.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-red-200/60 dark:divide-red-900/40">
          {contracts.map((c) => (
            <li key={c.contract_id} className="px-6 py-3">
              <Link
                href={`/contracts/${c.contract_id}`}
                className="block hover:bg-red-100/50 dark:hover:bg-red-950/40 -mx-6 px-6 py-1 -my-1 transition-colors group"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="text-sm font-medium truncate text-red-950 dark:text-red-50">
                    {c.contract_name}
                  </div>
                  <span className="text-xs text-red-900/70 dark:text-red-200/70 tabular-nums shrink-0">
                    Boucle {Math.round(c.globalScore * 100)}%
                  </span>
                </div>
                <SegmentBar segments={c.segmentScores} />
                <div className="text-xs text-red-900/70 dark:text-red-200/70 mt-2 flex items-center justify-between">
                  <span>{c.reasonDetail}</span>
                  <span className="inline-flex items-center gap-1 group-hover:text-red-950 dark:group-hover:text-red-50">
                    Voir
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function SegmentBar({ segments }: { segments: ContractUnderTension['segmentScores'] }) {
  const items = [
    { key: 'promised', label: 'PROMIS', value: segments.promised },
    { key: 'planned', label: 'PLANIFIÉ', value: segments.planned },
    { key: 'executed', label: 'EXÉCUTÉ', value: segments.executed },
    { key: 'proven', label: 'PROUVÉ', value: segments.proven },
    { key: 'validated', label: 'VALIDÉ', value: segments.validated },
  ] as const
  return (
    <div className="flex gap-1" data-testid="segment-bar">
      {items.map((s) => {
        const isLow = s.value < 0.5
        return (
          <div
            key={s.key}
            data-testid={`segment-${s.key}`}
            data-low={isLow ? 'true' : 'false'}
            className={`flex-1 h-1.5 rounded-full ${isLow ? 'bg-amber-300' : 'bg-emerald-300'} relative`}
            title={`${s.label} : ${Math.round(s.value * 100)}%`}
          >
            <div
              className={`h-full rounded-full ${isLow ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.round(s.value * 100)}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}
