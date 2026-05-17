// Phase 4.3 — Indicateur « Niveau de confiance du dossier ».
//
// Trois états visuels sobres, calculés depuis la couverture de preuve
// agrégée par contrat (RPC contract_summaries, migration 047).
//
// Doctrine : c'est une mesure d'auto-évaluation de la robustesse défensive
// du dossier, jamais une note de performance. Le wording « confiance » est
// volontairement choisi pour évoquer la défendabilité juridique, pas la
// productivité.

import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import { cn } from '@/lib/utils'

type Level = 'high' | 'medium' | 'low'

const LABELS: Record<Level, string> = {
  high: 'Confiance élevée',
  medium: 'À renforcer',
  low: 'Trous documentés',
}

const TOOLTIPS: Record<Level, string> = {
  high: 'Dossier défendable — interventions documentées avec photos et validations suffisantes.',
  medium: 'Couverture partielle — certaines interventions manquent de photos ou de validations.',
  low: 'Dossier fragile — plusieurs prestations sans preuve documentée. À compléter avant tout litige.',
}

const ICONS: Record<Level, React.ComponentType<{ className?: string }>> = {
  high: ShieldCheck,
  medium: ShieldAlert,
  low: ShieldX,
}

const STYLES: Record<Level, string> = {
  high: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  medium: 'bg-amber-50 border-amber-200 text-amber-700',
  low: 'bg-rose-50 border-rose-200 text-rose-700',
}

export function DossierConfidenceBadge({
  level,
  proofCoverage,
  variant = 'default',
  className,
}: {
  level: Level
  proofCoverage?: number
  variant?: 'default' | 'compact'
  className?: string
}) {
  const Icon = ICONS[level]
  const pct = proofCoverage != null ? Math.round(proofCoverage * 100) : null

  if (variant === 'compact') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium',
          STYLES[level],
          className,
        )}
        title={pct != null ? `${TOOLTIPS[level]} Couverture : ${pct}%` : TOOLTIPS[level]}
      >
        <Icon className="h-3 w-3" />
        {LABELS[level]}
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium',
        STYLES[level],
        className,
      )}
      title={TOOLTIPS[level]}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{LABELS[level]}</span>
      {pct != null && (
        <span className="text-[10px] opacity-70 tabular-nums">· {pct}%</span>
      )}
    </span>
  )
}
