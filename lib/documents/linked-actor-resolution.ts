// Résolution structurée linkedActorTemporaryKey → assigned_company_id / assigned_contact_id.
// Fonction pure : aucune dépendance DB, testable en isolation.

export type ActorAssignment = {
  siteActionId: string
  kind: 'company' | 'contact'
  actorId: string
}

export type DecisionActorAssignment = {
  siteDecisionId: string
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

export type ReserveActorAssignment = {
  siteReserveId: string
  companyId: string
}

/**
 * Résout les références linkedActorTemporaryKey des propositions reservation
 * vers l'ID de compagnie responsable de la levée.
 * Résolution exclusive par stable_key, aucun fallback. Seule la company est
 * ciblée (responsible_company_id) — pas de contact pour les réserves.
 */
export function resolveLinkedActorsForReserves(
  reservationProposals: Array<{
    id: string
    source_payload: Record<string, unknown> | null
  }>,
  materializedReserves: Map<string, string>,  // proposalId → siteReserveId
  stableKeyToCompanyId: Map<string, string>,
): ReserveActorAssignment[] {
  const results: ReserveActorAssignment[] = []

  for (const rp of reservationProposals) {
    const actorKey = rp.source_payload?.['linkedActorTemporaryKey']
    if (!actorKey || typeof actorKey !== 'string') continue

    const siteReserveId = materializedReserves.get(rp.id)
    if (!siteReserveId) continue

    const companyId = stableKeyToCompanyId.get(actorKey)
    if (companyId) {
      results.push({ siteReserveId, companyId })
    }
  }

  return results
}

/**
 * Résout les références linkedActorTemporaryKey des propositions decision
 * vers les IDs de compagnie ou contact déjà matérialisés dans le même run.
 * Même règles que resolveLinkedActors — résolution exclusive par stable_key.
 */
export function resolveLinkedActorsForDecisions(
  decisionProposals: Array<{
    id: string
    source_payload: Record<string, unknown> | null
  }>,
  materializedDecisions: Map<string, string>,  // proposalId → siteDecisionId
  stableKeyToCompanyId: Map<string, string>,
  stableKeyToContactId: Map<string, string>,
): DecisionActorAssignment[] {
  const results: DecisionActorAssignment[] = []

  for (const dp of decisionProposals) {
    const actorKey = dp.source_payload?.['linkedActorTemporaryKey']
    if (!actorKey || typeof actorKey !== 'string') continue

    const siteDecisionId = materializedDecisions.get(dp.id)
    if (!siteDecisionId) continue

    const companyId = stableKeyToCompanyId.get(actorKey)
    if (companyId) {
      results.push({ siteDecisionId, kind: 'company', actorId: companyId })
      continue
    }

    const contactId = stableKeyToContactId.get(actorKey)
    if (contactId) {
      results.push({ siteDecisionId, kind: 'contact', actorId: contactId })
    }
  }

  return results
}
