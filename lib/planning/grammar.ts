import { dayState, type DayFacts } from '@/lib/planning/month-view'

export type PlanningGrammarState =
  | 'rhythm_planned'
  | 'intervention_planned'
  | 'completed'
  | 'closed'
  | 'conflict'
  | 'hole'
  | 'empty'

export interface PlanningGrammarMeta {
  label: string
  shortLabel: string
  description: string
  badgeClassName: string
  textClassName: string
}

export const PLANNING_GRAMMAR: Record<PlanningGrammarState, PlanningGrammarMeta> = {
  rhythm_planned: {
    label: 'Prévu par le rythme',
    shortLabel: 'Rythme',
    description: 'Occurrence prévue par un rythme ou un roulement, sans intervention matérialisée.',
    badgeClassName: 'border-dashed border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200',
    textClassName: 'text-slate-700 dark:text-slate-200',
  },
  intervention_planned: {
    label: 'Intervention planifiée',
    shortLabel: 'Planifiée',
    description: 'Intervention réelle créée dans le planning.',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100',
    textClassName: 'text-emerald-700 dark:text-emerald-200',
  },
  completed: {
    label: 'Réalisé',
    shortLabel: 'Réalisé',
    description: 'Intervention terminée ou validée.',
    badgeClassName: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-100',
    textClassName: 'text-teal-700 dark:text-teal-200',
  },
  closed: {
    label: 'Annulé / Fermeture',
    shortLabel: 'Fermeture',
    description: 'Jour fermé ou intervention annulée pour ce jour.',
    badgeClassName: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
    textClassName: 'text-sky-700 dark:text-sky-200',
  },
  conflict: {
    label: 'Conflit',
    shortLabel: 'Conflit',
    description: 'Deux faits incompatibles demandent une décision.',
    badgeClassName: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
    textClassName: 'text-rose-700 dark:text-rose-200',
  },
  hole: {
    label: 'Trou de couverture',
    shortLabel: 'Trou',
    description: 'Le chantier est ouvert et couvert par un roulement publié, mais personne n\'y est prévu ce jour.',
    badgeClassName: 'border-rose-200 bg-rose-50/80 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
    textClassName: 'text-rose-700 dark:text-rose-200',
  },
  empty: {
    label: 'Rien de prévu',
    shortLabel: 'Vide',
    description: 'Aucune projection, intervention, fermeture ou conflit.',
    badgeClassName: 'border-border bg-background/60 text-muted-foreground',
    textClassName: 'text-muted-foreground',
  },
}

export function planningStateFromInterventionStatus(status: string | null | undefined): PlanningGrammarState {
  if (status === 'completed' || status === 'validated') return 'completed'
  if (status === 'skipped' || status === 'cancelled') return 'closed'
  return 'intervention_planned'
}

/**
 * Dérive l'état de présentation à partir de LA seule décision canonique,
 * `dayState()` (lib/planning/month-view.ts) — jamais une deuxième
 * implémentation du même arbitrage. Le seul raffinement propre à cette
 * couche est la distinction intervention_planned / completed, invisible
 * pour `dayState` (qui les regroupe sous 'ok' pour le routage de clic).
 */
export function planningStateFromDayFacts(f: DayFacts): PlanningGrammarState {
  const state = dayState(f)
  switch (state) {
    case 'conflict':
      return 'conflict'
    case 'closed':
      return 'closed'
    case 'hole':
      return 'hole'
    case 'projected':
      return 'rhythm_planned'
    case 'empty':
      return 'empty'
    case 'ok':
      return f.expected > 0 || f.kept > 0 ? 'intervention_planned' : 'completed'
  }
}

export function planningStateLabel(state: PlanningGrammarState): string {
  return PLANNING_GRAMMAR[state].label
}
