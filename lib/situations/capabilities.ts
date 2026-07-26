import type { PromiseSubjectRef } from '@/lib/memory/signals/operational-contract'
import type { SituationCapability, SituationSource } from './situation'

function resolvableHref(href: string | null | undefined): string | null {
  const value = href?.trim() ?? ''
  return value.length > 0 ? value : null
}

export function openSourceCapability(source: SituationSource | null): SituationCapability[] {
  const href = resolvableHref(source?.href)
  if (!href) return []
  return [{ kind: 'open_source', label: 'Voir la source', href }]
}

/**
 * Capacités de RÉSOLUTION d'une promesse — présentes uniquement quand la
 * situation porte un `subject` (objet persistant mutable). « Réalisée » n'affiche
 * jamais « Confirmer » (réservé à la validation/promotion). L'action de suivi est
 * un geste DISTINCT : elle ne résout pas. Les libellés sont la vérité de l'UI.
 */
export function promiseResolutionCapabilities(subject: PromiseSubjectRef | null): SituationCapability[] {
  if (!subject) return []
  return [
    { kind: 'fulfill_promise', label: 'Marquer comme réalisée' },
    { kind: 'cancel_promise', label: 'Annuler' },
    { kind: 'replace_promise', label: 'Remplacer' },
    { kind: 'create_follow_up_action', label: 'Créer une action de suivi' },
  ]
}
