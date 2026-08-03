// Résolution structurée linkedActorTemporaryKey → assigned_company_id / assigned_contact_id.
// Fonction pure : aucune dépendance DB, testable en isolation.

export type ActorAssignment = {
  siteActionId: string
  kind: 'company' | 'contact'
  actorId: string
}

/**
 * Résout les références linkedActorTemporaryKey des propositions action
 * vers les IDs de compagnie ou contact déjà matérialisés dans le même run.
 *
 * Règles de résolution :
 * - La clé est cherchée exclusivement dans stableKeyToCompanyId puis stableKeyToContactId.
 * - Ces maps sont construites depuis les propositions person/company du MÊME run.
 * - Aucun fallback par nom, page ou présence dans le même document.
 * - Clé absente ou inconnue → aucune attribution.
 */
export function resolveLinkedActors(
  actionProposals: Array<{
    id: string
    source_payload: Record<string, unknown> | null
  }>,
  materializedActions: Map<string, string>,  // proposalId → siteActionId
  stableKeyToCompanyId: Map<string, string>,
  stableKeyToContactId: Map<string, string>,
): ActorAssignment[] {
  const results: ActorAssignment[] = []

  for (const ap of actionProposals) {
    const actorKey = ap.source_payload?.['linkedActorTemporaryKey']
    if (!actorKey || typeof actorKey !== 'string') continue

    const siteActionId = materializedActions.get(ap.id)
    if (!siteActionId) continue

    const companyId = stableKeyToCompanyId.get(actorKey)
    if (companyId) {
      results.push({ siteActionId, kind: 'company', actorId: companyId })
      continue
    }

    const contactId = stableKeyToContactId.get(actorKey)
    if (contactId) {
      results.push({ siteActionId, kind: 'contact', actorId: contactId })
    }
  }

  return results
}
