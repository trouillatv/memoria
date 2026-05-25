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
