// NORM-2 — Regroupement de présentation des Prestations prévues (mandat Vincent
// 2026-09-25). PUR affichage : ne modifie ni ne persiste rien sur `engagements`.
// Dérivé UNIQUEMENT de `category`/`kind` (colonnes déjà en base) — jamais de
// regex sur `short_label`, jamais d'IA, jamais de regroupement sémantique
// inféré par le texte. Chaque Engagement reste une entrée distincte : ces
// sections ne fusionnent jamais plusieurs Engagements en une seule carte.

import type { EngagementCategory, EngagementKind } from '@/types/db'
import type { PlannedEngagement } from '@/lib/db/engagements'

export type PlannedEngagementSectionKey =
  | 'recurring'
  | 'quality_control'
  | 'reporting_deliverables'
  | 'safety_compliance'
  | 'other_event_kickoff'

export const PLANNED_ENGAGEMENT_SECTION_ORDER: PlannedEngagementSectionKey[] = [
  'recurring',
  'quality_control',
  'reporting_deliverables',
  'safety_compliance',
  'other_event_kickoff',
]

export const PLANNED_ENGAGEMENT_SECTION_LABELS: Record<PlannedEngagementSectionKey, string> = {
  recurring: 'Prestations récurrentes',
  quality_control: 'Contrôles & qualité',
  reporting_deliverables: 'Reporting & livrables',
  safety_compliance: 'Sécurité & conformité',
  other_event_kickoff: 'Autres obligations / événementiel & démarrage',
}

/**
 * Matrice category × kind → section, évaluée dans cet ORDRE (le premier
 * critère qui matche gagne — pas de score, pas d'ambiguïté à trancher au cas
 * par cas) :
 *   1. category === 'frequency'            → recurring
 *   2. kind === 'controle'                 → quality_control
 *   3. category === 'quality'              → quality_control
 *   4. category === 'reporting'            → reporting_deliverables
 *   5. kind === 'livrable'                 → reporting_deliverables
 *   6. category === 'compliance'           → safety_compliance
 *   7. fallback (sla, delivery, other,
 *      et tout kind restant : objectif,
 *      obligation, pénalité non couverts
 *      par 1-6)                            → other_event_kickoff
 *
 * Vérifié sur les 44 Engagements réels OCEF Compostage (2026-09-25) :
 * recurring=8, quality_control=6, reporting_deliverables=8,
 * safety_compliance=10, other_event_kickoff=12 → 44/44, aucune perte.
 */
export function getPlannedEngagementSection(input: {
  category: EngagementCategory
  kind: EngagementKind | null
}): PlannedEngagementSectionKey {
  const { category, kind } = input
  if (category === 'frequency') return 'recurring'
  if (kind === 'controle') return 'quality_control'
  if (category === 'quality') return 'quality_control'
  if (category === 'reporting') return 'reporting_deliverables'
  if (kind === 'livrable') return 'reporting_deliverables'
  if (category === 'compliance') return 'safety_compliance'
  return 'other_event_kickoff'
}

export interface PlannedEngagementSectionGroup {
  key: PlannedEngagementSectionKey
  label: string
  engagements: PlannedEngagement[]
}

/**
 * Statut commun à tous les Engagements d'une section, ou `null` si la section
 * est mixte (curated + active mélangés). Sert uniquement à éviter de répéter
 * un badge de statut identique sur chaque carte d'une section homogène — le
 * statut par Engagement reste toujours accessible individuellement dans le
 * détail de sa carte, quel que soit le résultat de cette fonction.
 */
export function getSectionHomogeneousStatus(
  group: Pick<PlannedEngagementSectionGroup, 'engagements'>,
): 'curated' | 'active' | null {
  if (group.engagements.length === 0) return null
  const first = group.engagements[0].status
  return group.engagements.every((e) => e.status === first) ? first : null
}

/**
 * Regroupe sans réordonner : chaque Engagement conserve sa position relative
 * (tri déjà appliqué en amont par kindRank/createdAt) à l'intérieur de sa
 * section. Sections vides omises ; ordre des sections toujours stable
 * (PLANNED_ENGAGEMENT_SECTION_ORDER), jamais dépendant du contenu.
 */
export function groupPlannedEngagementsBySection(
  engagements: PlannedEngagement[],
): PlannedEngagementSectionGroup[] {
  const buckets = new Map<PlannedEngagementSectionKey, PlannedEngagement[]>()
  for (const e of engagements) {
    const key = getPlannedEngagementSection({ category: e.category, kind: e.kind })
    const bucket = buckets.get(key)
    if (bucket) bucket.push(e)
    else buckets.set(key, [e])
  }
  return PLANNED_ENGAGEMENT_SECTION_ORDER
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, label: PLANNED_ENGAGEMENT_SECTION_LABELS[key], engagements: buckets.get(key)! }))
}
