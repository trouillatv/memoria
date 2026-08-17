import 'server-only'

// Cœur d'écriture RELATION_CLAIM (P4-D1, Vincent 2026-08-17), même doctrine
// d'extraction que confirmSiteFact (lib/db/site-fact-write.ts) et
// confirmActorAlias (lib/db/actor-alias-write.ts) : appelable HORS contexte
// HTTP/cookies, pour qu'un harnais de recette réversible emprunte EXACTEMENT
// le même chemin que la server action de production.
//
// Réutilise STRICTEMENT canonical_subject_links + canonical_subject_link_evidence
// (mig 316, moteur P0-B1) — même schéma, même whitelist de relation_type,
// aucune nouvelle table. Différence avec le moteur P0-B1
// (produceRelationsFromOccurrences, lib/ai/produce-relations-from-occurrences.ts) :
// celui-ci écrit status='suggested' depuis une co-occurrence statistique. Ici,
// l'utilisateur vient d'affirmer et de valider la relation lui-même — on écrit
// status='confirmed' DIRECTEMENT, avec confirmed_at/confirmed_by renseignés dès
// la création (même différence que OBSERVATION/FACT : écriture directe, pas de
// file de suggestions).
//
// Contrainte UNIQUE(site_id, pair_low_id, pair_high_id) (mig 316) : une seule
// relation, tout type confondu, par paire de sujets. Un conflit ici n'est PAS
// une erreur d'idempotence Copilote (copilot_proposal_id) — c'est un désaccord
// avec une relation déjà en base sur cette paire, à faire remonter tel quel.

import { createAdminClient } from '@/lib/supabase/admin'
import { updateCopilotProposalStatus } from '@/lib/db/copilot-telemetry'
import { todayLocalIso } from '@/lib/time/local-date'
import type { RelationClaimType } from '@/lib/visits/copilot-relation-claim'

export type ConfirmSiteRelationParams = {
  siteId: string
  userId: string
  relationType: RelationClaimType
  sourceSubjectId: string
  targetSubjectId: string
  /** Phrase source verbatim de l'utilisateur — devient link_evidence.evidence_text. */
  evidenceText: string
  copilotProposalId: string
  interactionId: string | null
}

export type ConfirmSiteRelationResult =
  | { ok: true; linkId: string }
  | { ok: false; error: string }

export async function confirmSiteRelation(params: ConfirmSiteRelationParams): Promise<ConfirmSiteRelationResult> {
  const { siteId, userId, relationType, sourceSubjectId, targetSubjectId, evidenceText, copilotProposalId, interactionId } = params
  const admin = createAdminClient()

  // Idempotence : la même proposition ne peut créer qu'un seul lien (même
  // mécanique que copilot_proposal_id sur actor_alias / site_knowledge_entries).
  const { data: existing } = await admin
    .from('canonical_subject_links')
    .select('id')
    .eq('copilot_proposal_id', copilotProposalId)
    .maybeSingle()
  if (existing) {
    const row = existing as { id: string }
    if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
    return { ok: true, linkId: row.id }
  }

  const { data: inserted, error: linkError } = await admin
    .from('canonical_subject_links')
    .insert({
      site_id: siteId,
      source_subject_id: sourceSubjectId,
      target_subject_id: targetSubjectId,
      relation_type: relationType,
      status: 'confirmed',
      created_by: userId,
      confirmed_at: new Date().toISOString(),
      confirmed_by: userId,
      copilot_proposal_id: copilotProposalId,
    })
    .select('id')
    .single()

  if (linkError || !inserted) {
    const message = linkError?.message ?? ''
    if (message.includes('duplicate key') || message.includes('23505')) {
      if (message.includes('canonical_subject_links_copilot_proposal_id_key')) {
        return { ok: false, error: 'Cette relation est déjà enregistrée.' }
      }
      return { ok: false, error: 'Une relation existe déjà entre ces deux sujets. Modifiez-la depuis la fiche du sujet plutôt que par le Copilote.' }
    }
    return { ok: false, error: message || "Impossible d'enregistrer cette relation." }
  }

  const linkId = (inserted as { id: string }).id

  const { error: evidenceError } = await admin
    .from('canonical_subject_link_evidence')
    .insert({
      link_id: linkId,
      occurrence_id: null,
      evidence_text: evidenceText,
      observed_at: todayLocalIso(),
      source_proposal_id: null,
    })

  if (evidenceError) {
    // La preuve est l'invariant fondamental de P0-B1 (evidence_text NOT NULL) —
    // un lien sans preuve ne doit jamais rester en base. Rollback explicite,
    // pas de confiance dans une future lecture pour rattraper l'incohérence.
    await admin.from('canonical_subject_links').delete().eq('id', linkId)
    return { ok: false, error: "Impossible d'enregistrer la preuve de cette relation." }
  }

  if (interactionId) void updateCopilotProposalStatus(interactionId, 'confirmed')
  return { ok: true, linkId }
}
