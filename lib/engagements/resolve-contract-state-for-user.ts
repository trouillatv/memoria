// DOC-CONTRACT-OS-1B2-B3 (mandat Vincent 2026-09-29, sur 1B2-A FINAL CLOSED /
// 1B2-B1 CODE CLOSED / 1B2-B2 CODE CLOSED) — primitive serveur canonique
// exposant le resolver pur B1 (`resolveEngagementAtDate`) à un appelant
// applicatif authentifié.
//
// Chaîne d'autorisation obligatoire, fail-closed à chaque maillon :
//   utilisateur → appartenance organisation (M2B, `resolveResourceAccess`)
//   → organisation/chantier DE L'ENGAGEMENT LUI-MÊME → engagement_contract_effects.
//
// Réutilise `resolveResourceAccess` (lib/auth/resource-access.ts, M2B) —
// aucun système d'autorisation parallèle. L'organisation ne vient jamais de
// l'appelant ni du client, toujours de la ligne `engagements` elle-même.
//
// AUCUNE recomposition de la logique temporelle ici : ce module charge,
// mappe, puis délègue intégralement à `resolveEngagementAtDate` (B1).
// queriedDate est TOUJOURS fourni par l'appelant — jamais new Date()/
// Date.now()/CURRENT_DATE dans ce fichier.
//
// Charge l'INTÉGRALITÉ de l'historique des effets d'un Engagement (jamais un
// filtre « actuellement actif ») : la reconstruction historique à une date X
// exige de voir permanent → bounded → expiration → retour au permanent.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteById } from '@/lib/db/sites'
import { resolveResourceAccess } from '@/lib/auth/resource-access'
import {
  resolveEngagementAtDate,
  type EngagementContractEffectRow,
  type EngagementContractStateDTO,
  type MaterializedContractEffect,
} from '@/lib/engagements/resolve-contract-state'
import type { ContractTemporality } from '@/lib/engagements/contract-effect'
import type { DbUser } from '@/types/db'

export type ResolveEngagementContractStateForUserError = 'access_denied' | 'invalid_date'

export type ResolveEngagementContractStateForUserResult =
  | { ok: true; state: EngagementContractStateDTO }
  | { ok: false; error: ResolveEngagementContractStateForUserError }

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Rejette tout ce qui n'est pas un YYYY-MM-DD calendaire réel (pas de
// timestamp, pas de 2026-13-40) — jamais un `new Date(input)` laissé
// reconstruire une date approximative.
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

type EngagementContractEffectDbRow = {
  id: string
  engagement_id: string
  effect: string
  temporality: string
  scope_key: string
  effect_payload: Record<string, unknown> | null
  starts_on: string | null
  ends_on: string | null
  resume_on: string | null
  source_document_id: string
  source_proposal_id: string
  applied_at: string
}

function mapRow(row: EngagementContractEffectDbRow): EngagementContractEffectRow {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    effect: row.effect as MaterializedContractEffect,
    temporality: row.temporality as ContractTemporality,
    scopeKey: row.scope_key,
    effectPayload: row.effect_payload ?? {},
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    resumeOn: row.resume_on,
    sourceDocumentId: row.source_document_id,
    sourceProposalId: row.source_proposal_id,
    appliedAt: row.applied_at,
  }
}

/**
 * Résout l'état contractuel d'un Engagement à une date donnée, pour
 * l'utilisateur courant (ou fourni). Ne lève jamais pour un refus
 * d'autorisation ou une date invalide — rend un résultat discriminé,
 * message uniforme (`access_denied`), aucun oracle sur l'existence d'un
 * Engagement d'une autre organisation.
 */
export async function resolveEngagementContractStateForUser(
  engagementId: string,
  queriedDate: string,
  currentUser?: Pick<DbUser, 'id'> | null,
): Promise<ResolveEngagementContractStateForUserResult> {
  if (!isValidIsoDate(queriedDate)) return { ok: false, error: 'invalid_date' }

  const access = await resolveResourceAccess({ kind: 'engagement', id: engagementId }, currentUser)
  if (!access.ok) return { ok: false, error: 'access_denied' }

  const supabase = createAdminClient()

  // Jamais un site_id fourni par le client : toujours celui de la ligne
  // elle-même (même discipline que `getEngagementAuthContext`).
  const { data: engagementRow, error: engagementError } = await supabase
    .from('engagements')
    .select('id, organization_id, site_id')
    .eq('id', engagementId)
    .maybeSingle()
  if (engagementError || !engagementRow) return { ok: false, error: 'access_denied' }

  // Incohérence démontrée entre l'organisation résolue par M2B et la ligne
  // elle-même : jamais absorbée silencieusement, toujours refusée.
  if (engagementRow.organization_id !== access.context.organizationId) {
    console.error(
      `[resolve-contract-state-for-user] engagement ${engagementId} organization_id incohérent avec la résolution d'accès`,
    )
    return { ok: false, error: 'access_denied' }
  }

  // Vérification du chantier : le modèle d'autorisation du dépôt n'a pas de
  // droit par-chantier distinct de l'appartenance organisation (cf.
  // lib/auth/resource-access.ts) — la garantie « chantier auquel l'appelant
  // n'a pas accès » se traduit ici par une cohérence stricte organisation
  // Engagement ↔ organisation chantier, refusée si démontrée fausse.
  if (engagementRow.site_id) {
    const site = await getSiteById(engagementRow.site_id)
    if (!site || site.organization_id !== engagementRow.organization_id) {
      console.error(
        `[resolve-contract-state-for-user] engagement ${engagementId} chantier ${engagementRow.site_id} organisation incohérente`,
      )
      return { ok: false, error: 'access_denied' }
    }
  }

  // Historique COMPLET — jamais un filtre "actuellement actif" qui casserait
  // la reconstruction permanent → bounded → expiration → retour au permanent.
  const { data: effectRows, error: effectsError } = await supabase
    .from('engagement_contract_effects')
    .select(
      'id, engagement_id, effect, temporality, scope_key, effect_payload, starts_on, ends_on, resume_on, source_document_id, source_proposal_id, applied_at',
    )
    .eq('engagement_id', engagementId)
  if (effectsError) return { ok: false, error: 'access_denied' }

  const effects = ((effectRows ?? []) as EngagementContractEffectDbRow[]).map(mapRow)

  const state = resolveEngagementAtDate({ engagementId, effects }, queriedDate)
  return { ok: true, state }
}
