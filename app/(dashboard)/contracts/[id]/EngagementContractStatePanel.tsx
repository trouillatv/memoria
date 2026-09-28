// DOC-CONTRACT-OS-1B2-B4 (mandat Vincent 2026-09-29, sur 1B2-B3 CODE CLOSED)
// — consommateur LECTURE SEULE de `resolveEngagementContractStateForUser`.
//
// Aucune logique temporelle ici : ce composant se contente de FORMATER le
// DTO déjà résolu par B3/B1. Ne recalcule jamais une existence, une
// applicabilité ou une valeur — un `value == null` n'est JAMAIS présenté
// comme « aucune obligation », toujours comme une valeur structurée absente
// à défaut de règle source.

import { cn } from '@/lib/utils'
import type {
  EngagementExistenceStatus,
  ScopeApplicability,
  ScopeState,
} from '@/lib/engagements/resolve-contract-state'
import type { ResolveEngagementContractStateForUserResult } from '@/lib/engagements/resolve-contract-state-for-user'

interface EngagementContractStatePanelProps {
  result: ResolveEngagementContractStateForUserResult | undefined
}

const EXISTENCE_LABELS: Record<EngagementExistenceStatus, string> = {
  not_yet_existing: 'Pas encore applicable',
  exists: 'Applicable',
  expired: 'Expiré',
  undetermined: 'Indéterminé (conflit)',
}

const EXISTENCE_TONE: Record<EngagementExistenceStatus, string> = {
  not_yet_existing: 'bg-slate-100 text-slate-700',
  exists: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-muted text-muted-foreground',
  undetermined: 'bg-amber-100 text-amber-800',
}

const APPLICABILITY_LABELS: Record<ScopeApplicability, string> = {
  applicable: 'Applicable',
  suspended: 'Suspendu',
  indeterminate: 'Indéterminé',
}

function formatScopeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'Valeur structurée non disponible — consulter la règle source.'
  }
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return 'Valeur structurée non disponible — consulter la règle source.'
  }
}

function ScopeRow({ scope }: { scope: ScopeState }) {
  return (
    <li className="flex items-start justify-between gap-3 text-[11px]">
      <div className="min-w-0">
        <span className="font-medium text-foreground">{scope.scopeKey}</span>
        <span className="text-muted-foreground"> — {formatScopeValue(scope.value)}</span>
        {scope.dominatedByWholeEngagementSuspend && (
          <span className="block text-amber-700">Suspendu par l&apos;Engagement entier.</span>
        )}
        {scope.indeterminateReason && (
          <span className="block text-amber-700">{scope.indeterminateReason}</span>
        )}
      </div>
      <span
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 font-medium',
          scope.applicability === 'applicable' && 'bg-emerald-100 text-emerald-800',
          scope.applicability === 'suspended' && 'bg-amber-100 text-amber-800',
          scope.applicability === 'indeterminate' && 'bg-slate-100 text-slate-700',
        )}
      >
        {APPLICABILITY_LABELS[scope.applicability]}
      </span>
    </li>
  )
}

/**
 * Panneau lecture seule : état contractuel d'un Engagement à la date
 * fournie par l'appelant (jamais recalculée ici). N'affiche ni historique,
 * ni Planning, ni action de matérialisation — cf. mandat 1B2-B4.
 */
export function EngagementContractStatePanel({ result }: EngagementContractStatePanelProps) {
  if (!result) return null
  if (!result.ok) {
    return (
      <p className="mt-3 pt-3 border-t text-[11px] text-muted-foreground italic">
        État contractuel non disponible.
      </p>
    )
  }

  const { state } = result
  const isLegacy = state.existence.foundedBy === null

  return (
    <div className="mt-3 pt-3 border-t space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          État contractuel
        </span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-medium',
            EXISTENCE_TONE[state.existence.status],
          )}
        >
          {EXISTENCE_LABELS[state.existence.status]}
        </span>
      </div>

      {isLegacy && (
        <p className="text-[11px] text-muted-foreground italic">
          Engagement historique — aucune reconstruction structurée disponible, se référer au texte source.
        </p>
      )}

      {state.resolutionIssue && (
        <p className="text-[11px] text-amber-700">
          Conflit non résolu : plusieurs effets fondateurs concurrents sur cet Engagement.
        </p>
      )}

      {state.anomalies.length > 0 && (
        <p className="text-[11px] text-muted-foreground italic">
          {state.anomalies.length} anomalie{state.anomalies.length > 1 ? 's' : ''} de donnée détectée
          {state.anomalies.length > 1 ? 's' : ''} — sans effet sur la règle applicable ci-dessus.
        </p>
      )}

      {state.scopes.length > 0 && (
        <ul className="space-y-1 pt-1">
          {state.scopes.map((scope) => (
            <ScopeRow key={scope.scopeKey} scope={scope} />
          ))}
        </ul>
      )}
    </div>
  )
}
