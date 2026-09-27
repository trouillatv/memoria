// NORM-2 — Regroupement de présentation des Prestations prévues (mandat Vincent
// 2026-09-25). PUR affichage : ne modifie ni ne persiste rien sur `engagements`.
// Dérivé UNIQUEMENT de `category`/`kind` (colonnes déjà en base) — jamais de
// regex sur `short_label`, jamais d'IA, jamais de regroupement sémantique
// inféré par le texte. Chaque Engagement reste une entrée distincte : ces
// sections ne fusionnent jamais plusieurs Engagements en une seule carte.

import type { EngagementCategory, EngagementKind } from '@/types/db'
import type { EngagementMission, PlannedEngagement } from '@/lib/db/engagements'
import type { EngagementAction } from '@/lib/db/site-action-engagement-links'

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

export interface PlannedEngagementSynthesis {
  total: number
  /** Pas encore en vigueur — cf. plannedEngagementStatusLabel('curated'). */
  curatedCount: number
  /** En vigueur — cf. plannedEngagementStatusLabel('active'). */
  activeCount: number
  withMission: number
  /** Actif mais sans aucune Mission organisatrice (pas encore prise en charge). */
  withoutMission: number
  /** Actif ET (sans Mission, ou aucune Mission n'a de prochaine occurrence connue). */
  needsPlanning: number
  /** Actions ouvertes liées (P0-4B), dédupliquées : une Action liée à plusieurs
   *  Engagements ne compte qu'une fois. */
  openActionsCount: number
}

/**
 * Synthèse légère de la page Prestations prévues (ENG-UX-1 LOT F, mandat
 * Vincent 2026-09-26) — dérivée UNIQUEMENT des read-models déjà batchés
 * (LOT B `getMissionsForEngagements`, LOT C `getActionsForEngagements`),
 * aucune nouvelle vérité persistée, aucun nouveau calcul métier. Un Engagement
 * `curated` (pas encore en vigueur) ne peut par construction avoir ni Mission
 * ni Action liée — il n'est jamais compté dans withMission/withoutMission/
 * needsPlanning, seulement dans `total`.
 */
export function computePlannedEngagementSynthesis(
  engagements: PlannedEngagement[],
  missionsByEngagement: Map<string, EngagementMission[]>,
  actionsByEngagement: Map<string, EngagementAction[]>,
): PlannedEngagementSynthesis {
  let curatedCount = 0
  let activeCount = 0
  let withMission = 0
  let withoutMission = 0
  let needsPlanning = 0
  for (const e of engagements) {
    if (e.status !== 'active') {
      curatedCount++
      continue
    }
    activeCount++
    // ENG-UX-1 MICRO-FIX (mandat Vincent 2026-09-26) — une Mission inactive
    // n'organise pas l'Engagement : elle ne doit ni compter comme prise en
    // charge actuelle, ni éviter le compteur "à planifier".
    const missions = (missionsByEngagement.get(e.id) ?? []).filter((m) => m.active)
    if (missions.length > 0) withMission++
    else withoutMission++
    const hasUpcoming = missions.some((m) => !!m.nextInterventionDate)
    if (!hasUpcoming) needsPlanning++
  }

  const openActionIds = new Set<string>()
  for (const actions of actionsByEngagement.values()) {
    for (const a of actions) {
      if (a.active) openActionIds.add(a.actionId)
    }
  }

  return {
    total: engagements.length,
    curatedCount,
    activeCount,
    withMission,
    withoutMission,
    needsPlanning,
    openActionsCount: openActionIds.size,
  }
}

/**
 * PLAN-UX-1D (mandat Vincent 2026-09-27) — onglets par état de pilotage de la
 * page Prestations prévues. Réutilise EXACTEMENT la même lecture des
 * read-models que computePlannedEngagementSynthesis (aucune nouvelle vérité) :
 * `to_organize` reprend la logique de `withoutMission`, `to_plan` reprend
 * celle de `needsPlanning`. `with_open_action` s'applique quel que soit le
 * statut (curated ou active) car une Action peut rester ouverte après
 * bascule.
 */
export type PlannedEngagementTabKey =
  | 'all'
  | 'to_activate'
  | 'to_organize'
  | 'to_plan'
  | 'with_open_action'

export const PLANNED_ENGAGEMENT_TAB_ORDER: PlannedEngagementTabKey[] = [
  'all',
  'to_activate',
  'to_organize',
  'to_plan',
  'with_open_action',
]

export const PLANNED_ENGAGEMENT_TAB_LABELS: Record<PlannedEngagementTabKey, string> = {
  all: 'Tous',
  to_activate: 'À mettre en vigueur',
  to_organize: 'À organiser',
  to_plan: 'À planifier',
  with_open_action: 'Avec action ouverte',
}

export function plannedEngagementMatchesTab(
  tab: PlannedEngagementTabKey,
  engagement: PlannedEngagement,
  missions: EngagementMission[],
  actions: EngagementAction[],
): boolean {
  if (tab === 'all') return true
  if (tab === 'to_activate') return engagement.status === 'curated'
  if (tab === 'with_open_action') return actions.some((a) => a.active)
  if (engagement.status !== 'active') return false
  const activeMissions = missions.filter((m) => m.active)
  if (tab === 'to_organize') return activeMissions.length === 0
  // to_plan : actif ET (sans Mission, ou aucune Mission n'a de prochaine occurrence)
  return !activeMissions.some((m) => !!m.nextInterventionDate)
}

export function computePlannedEngagementTabCounts(
  engagements: PlannedEngagement[],
  missionsByEngagement: Map<string, EngagementMission[]>,
  actionsByEngagement: Map<string, EngagementAction[]>,
): Record<PlannedEngagementTabKey, number> {
  const counts: Record<PlannedEngagementTabKey, number> = {
    all: 0,
    to_activate: 0,
    to_organize: 0,
    to_plan: 0,
    with_open_action: 0,
  }
  for (const e of engagements) {
    const missions = missionsByEngagement.get(e.id) ?? []
    const actions = actionsByEngagement.get(e.id) ?? []
    for (const tab of PLANNED_ENGAGEMENT_TAB_ORDER) {
      if (plannedEngagementMatchesTab(tab, e, missions, actions)) counts[tab]++
    }
  }
  return counts
}

/**
 * Filtres avancés (PLAN-UX-1D) : Nature/Catégorie dérivées des colonnes
 * `kind`/`category` déjà en base ; Provenance dérivée de `primaryProvenance.
 * documentId` (null = créé manuellement, même logique que ProvenanceLine dans
 * PlannedEngagementCard — aucune nouvelle colonne). Recherche texte sur
 * `shortLabel` uniquement.
 */
export interface PlannedEngagementFilters {
  tab?: PlannedEngagementTabKey
  kind?: EngagementKind | null
  category?: EngagementCategory
  provenance?: 'manual' | 'document'
  documentFilename?: string
  search?: string
}

export function filterPlannedEngagements(
  engagements: PlannedEngagement[],
  missionsByEngagement: Map<string, EngagementMission[]>,
  actionsByEngagement: Map<string, EngagementAction[]>,
  filters: PlannedEngagementFilters,
): PlannedEngagement[] {
  const search = filters.search?.trim().toLowerCase()
  return engagements.filter((e) => {
    if (filters.tab && filters.tab !== 'all') {
      const missions = missionsByEngagement.get(e.id) ?? []
      const actions = actionsByEngagement.get(e.id) ?? []
      if (!plannedEngagementMatchesTab(filters.tab, e, missions, actions)) return false
    }
    if (filters.kind !== undefined && e.kind !== filters.kind) return false
    if (filters.category && e.category !== filters.category) return false
    if (filters.provenance) {
      const isManual = e.primaryProvenance.documentId === null
      if (filters.provenance === 'manual' && !isManual) return false
      if (filters.provenance === 'document' && isManual) return false
    }
    if (filters.documentFilename && e.primaryProvenance.documentFilename !== filters.documentFilename) {
      return false
    }
    if (search && !e.shortLabel.toLowerCase().includes(search)) return false
    return true
  })
}
