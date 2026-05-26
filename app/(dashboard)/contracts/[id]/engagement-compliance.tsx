'use client'

import { cn } from '@/lib/utils'
import type { EngagementComplianceRatios } from '@/types/db'

interface EngagementComplianceProps {
  ratios: EngagementComplianceRatios
  size?: 'compact' | 'medium' | 'detail'
}

const SEGMENT_LABELS = ['PROMIS', 'PLANIFIÉ', 'EXÉCUTÉ', 'PROUVÉ', 'VALIDÉ'] as const

// Couleurs par segment — palette sobre, alignée sur la philosophie cockpit
// (cf. cockpit-design.md §3 : "soft palette, no aggressive red")
const SEGMENT_COLORS = [
  'bg-slate-500',     // PROMIS
  'bg-sky-500',       // PLANIFIÉ
  'bg-indigo-500',    // EXÉCUTÉ
  'bg-amber-500',     // PROUVÉ
  'bg-emerald-500',   // VALIDÉ
] as const

function segmentValue(ratios: EngagementComplianceRatios, idx: number): number {
  switch (idx) {
    case 0: return ratios.promised ? 1 : 0
    case 1: return ratios.planned
    case 2: return ratios.executed
    case 3: return ratios.proven
    case 4: return ratios.validated
    default: return 0
  }
}

export function EngagementCompliance({ ratios, size = 'medium' }: EngagementComplianceProps) {
  const values = SEGMENT_LABELS.map((_, i) => segmentValue(ratios, i))

  if (size === 'compact') {
    // 5 dots reliés — version dashboard direction multi-contrat
    return (
      <div className="inline-flex items-center" role="img" aria-label="Compliance overview">
        {values.map((v, i) => {
          const filled = v >= 0.9 ? 'full' : v >= 0.5 ? 'half' : 'empty'
          return (
            <span key={i} className="inline-flex items-center">
              <span
                data-testid={`compliance-dot-${SEGMENT_LABELS[i].toLowerCase()}`}
                className={cn(
                  'inline-block w-3 h-3 rounded-full border',
                  filled === 'full' && 'bg-emerald-500 border-emerald-600',
                  filled === 'half' && 'bg-amber-300 border-amber-500',
                  filled === 'empty' && 'bg-muted border-muted-foreground/30',
                )}
                title={`${SEGMENT_LABELS[i]}: ${Math.round(v * 100)}%`}
              />
              {i < values.length - 1 && (
                <span className="w-2 h-px bg-muted-foreground/30 mx-0.5" aria-hidden />
              )}
            </span>
          )
        })}
      </div>
    )
  }

  // medium / detail — segments avec barre de remplissage + labels
  return (
    <div className={cn('w-full', size === 'detail' && 'space-y-3')}>
      <div className="flex items-center gap-2">
        {values.map((v, i) => {
          const widthPct = Math.max(0, Math.min(1, v)) * 100
          return (
            <div key={i} className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {SEGMENT_LABELS[i]}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {Math.round(v * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', SEGMENT_COLORS[i])}
                  style={{ width: `${widthPct}%` }}
                  aria-hidden
                />
              </div>
            </div>
          )
        })}
      </div>
      {size === 'detail' && <DetailFooter ratios={ratios} />}
    </div>
  )
}

function DetailFooter({ ratios }: { ratios: EngagementComplianceRatios }) {
  if (!ratios.promised) {
    return <p className="text-[11px] text-muted-foreground italic">Engagement non encore activé.</p>
  }

  // État INITIAL (rien n'a encore démarré) ≠ échec : on ne crie pas « à reprendre ».
  // Distingue « pas encore de données » d'un vrai maillon faible (Vincent 2026-05-27).
  const noActivity =
    ratios.planned === 0 && ratios.executed === 0 && ratios.proven === 0 && ratios.validated === 0
  if (noActivity) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Engagement en place — pas encore d&apos;activité documentée. À planifier dans une mission.
      </p>
    )
  }

  // Identify weakest link parmi planned/executed/proven/validated
  const dimensions = [
    { label: 'planification', v: ratios.planned, key: 'planned' },
    { label: 'exécution', v: ratios.executed, key: 'executed' },
    { label: 'preuves', v: ratios.proven, key: 'proven' },
    { label: 'validations', v: ratios.validated, key: 'validated' },
  ]
  const weakest = [...dimensions].sort((a, b) => a.v - b.v)[0]

  if (weakest.v >= 0.9) {
    return (
      <p className="text-[11px] text-emerald-700">
        Tout est en bonne progression sur cet engagement.
      </p>
    )
  }
  return (
    <p className="text-[11px] text-muted-foreground">
      Maillon faible : <span className="font-semibold">{weakest.label}</span>
      {' '}({Math.round(weakest.v * 100)}%).
      {weakest.v < 0.5 && (
        <span className="text-rose-700"> À reprendre cette semaine.</span>
      )}
    </p>
  )
}
