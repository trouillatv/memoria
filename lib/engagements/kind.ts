// Typage prescriptif des engagements (Vincent 2026-06-22, Sprint 1, migration 153).
// PUR & déterministe — la nature détermine les défauts de preuve et de destination.
// L'IA propose le type à l'extraction ; l'humain valide à la curation.

import type {
  EngagementKind,
  EngagementProofRequirement,
  EngagementDestination,
} from '@/types/db'

export const KIND_ORDER: EngagementKind[] = [
  'penalite', 'controle', 'livrable', 'obligation', 'objectif',
]

export const KIND_META: Record<
  EngagementKind,
  { label: string; short: string; description: string; badge: string }
> = {
  objectif: {
    label: 'Objectif',
    short: 'Objectifs',
    description: 'Résultat visé, non directement démontrable (chapeaute des contrôles).',
    badge: 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  },
  obligation: {
    label: 'Obligation',
    short: 'Obligations',
    description: 'Prestation ou action récurrente exigée.',
    badge: 'border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300',
  },
  livrable: {
    label: 'Livrable',
    short: 'Livrables',
    description: 'Document ou élément à fournir (DOE, PAQ, fiches…).',
    badge: 'border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300',
  },
  controle: {
    label: 'Contrôle',
    short: 'Contrôles',
    description: 'Essai ou vérification qui produit une preuve (essai plaque, ATP…).',
    badge: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
  },
  penalite: {
    label: 'Pénalité',
    short: 'Pénalités',
    description: 'Sanction ou retenue en cas de manquement.',
    badge: 'border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300',
  },
}

export function kindLabel(k: EngagementKind | null): string {
  return k ? KIND_META[k].label : 'Non typé'
}

/**
 * Preuve attendue par DÉFAUT selon la nature (pré-remplissage, l'humain ajuste).
 *   - controle  : produit une trace → demander une photo (preuve la plus proche)
 *   - autres    : exécution / document suffit pour le MVP (enum preuve limité)
 */
export function defaultProofForKind(
  k: EngagementKind | null,
): EngagementProofRequirement {
  return k === 'controle' ? 'photo' : 'none'
}

/** Une pénalité est par nature une vigilance (sinon on laisse la détection texte décider). */
export function destinationHintForKind(
  k: EngagementKind | null,
): EngagementDestination | null {
  return k === 'penalite' ? 'vigilance' : null
}
