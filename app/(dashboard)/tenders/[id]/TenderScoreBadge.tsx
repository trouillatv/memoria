import { Badge } from '@/components/ui/badge'

export function TenderScoreBadge({ score }: { score: number | null }) {
  // Pas de score calculé → rien (plutôt qu'un « — » qui fait badge/colonne mort).
  if (score === null || score === undefined) return null
  const cls =
    score >= 70 ? 'bg-emerald-100 text-emerald-700' :
    score >= 40 ? 'bg-amber-100 text-amber-700' :
                  'bg-rose-100 text-rose-700'
  return <Badge className={`text-xs font-mono ${cls}`}>{score}/100</Badge>
}
