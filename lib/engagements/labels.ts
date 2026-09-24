// Libellés FR des catégories d'engagement (affichage). Vincent 2026-05-25.

import type { EngagementCategory } from '@/types/db'

export const CATEGORY_LABELS: Record<EngagementCategory, string> = {
  frequency: 'Fréquence',
  quality: 'Qualité',
  compliance: 'Conformité',
  delivery: 'Prestation',
  sla: 'Niveau de service',
  reporting: 'Reporting',
  other: 'Autre',
}

export function categoryLabel(c: EngagementCategory): string {
  return CATEGORY_LABELS[c] ?? c
}

// P0-3 (mandat Vincent 2026-09-25) — libellés métier des deux seuls statuts
// affichés dans « Prestations prévues » (curated/active). 'curated' = extraction
// validée par un humain mais pas encore en vigueur (cf. migration 437 : curated
// ≠ active) ; 'active' = la règle s'applique réellement sur le chantier.
export const PLANNED_ENGAGEMENT_STATUS_LABELS = {
  curated: 'À mettre en vigueur',
  active: 'En vigueur',
} as const

export function plannedEngagementStatusLabel(status: 'curated' | 'active'): string {
  return PLANNED_ENGAGEMENT_STATUS_LABELS[status]
}
