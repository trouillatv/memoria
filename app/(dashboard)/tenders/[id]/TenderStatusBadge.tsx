import { StatusBadge } from '@/components/ui/status-badge'
import type { TenderStatus } from '@/types/db'

/**
 * Wrapper minimal autour du `StatusBadge` unifié (Slice C.1) — conservé pour
 * compatibilité d'API avec les consommateurs existants (`<TenderStatusBadge
 * status={t.status} />`). Le mapping label/couleurs vit désormais dans
 * `components/ui/status-badge.tsx`. Aucun mapping local.
 */
export function TenderStatusBadge({ status }: { status: TenderStatus }) {
  return <StatusBadge status={status} />
}
