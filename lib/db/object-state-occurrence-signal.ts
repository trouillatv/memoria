import 'server-only'

// P1-C2B.4 H2-B.2 — producteur du signal d'occurrence d'objet métier
// (object_state_occurrence_signal, migration 349).
//
// Mandat Vincent (2026-08-25) : implémenter la fonction qui, à partir d'une occurrence
// matérialisée (entity_type, entity_id), produit le signal local avec le mécanisme validé
// en H2-A — fast-path déterministe si un document_status exploitable existe, sinon IA
// sémantique sur le texte propre de l'entité, avec diagnostic de panne typé. Respecte
// l'unicité (entity_type, entity_id), gère resolved/unresolved, reste idempotente.
//
// HORS PÉRIMÈTRE de ce lot (mandat explicite) :
//   - Aucun calcul/persistance d'état courant du CBO (step2_signal + garde-fou R1/R2) —
//     final_signal est un simple pass-through de step1_signal côté LLM.
//
// Branchement live (P1-C2B H2-B.3, 2026-08-25) : appelée depuis
// lib/db/canonical-business-object-attach.ts (produceSignalBestEffort), juste après
// chaque tentative de rattachement CBO — couvre les 3 writers métier, le 4ᵉ writer
// partageant le même orchestrateur (confirmSiteAction), et l'import PV historique.
// Cette fonction elle-même reste inchangée : aucune seconde implémentation.
//
// Doctrine texte source (Vincent) : le texte analysé est TOUJOURS celui de l'entité
// elle-même (jamais le canonical_subject entier, jamais le texte de la proposition
// documentaire) — même carve-out que celui qui avait éliminé les faux CONTRADICTED
// (cf. mémoire canonical-business-object-doctrine).

import { createAdminClient } from '@/lib/supabase/admin'
import type { CanonicalBusinessObjectEntityType } from '@/lib/db/canonical-business-object-resolve'
import {
  classifyOccurrenceStateSignal,
  type ObjectStateSignal,
  type OccurrenceSignalErrorCode,
} from '@/lib/ai/classify-occurrence-state-signal'

type AdminClient = ReturnType<typeof createAdminClient>

const TARGET_TABLE: Record<CanonicalBusinessObjectEntityType, string> = {
  site_action: 'site_actions',
  site_reserve: 'site_reserve',
  site_deadline: 'site_deadlines',
}

export type ProduceOccurrenceSignalOutcome =
  | { kind: 'resolved'; source: 'document_status' | 'llm'; finalSignal: ObjectStateSignal }
  | { kind: 'unresolved'; errorCode: OccurrenceSignalErrorCode }
  | { kind: 'skipped_already_resolved'; finalSignal: ObjectStateSignal }

// Calqué sur scripts/p1c2b4i-h2a-live-mechanism-dryrun.ts::fromDocumentStatus — mapping
// déterministe validé en H2-A. Aucun appel LLM quand ce mapping s'applique (ÉTAPE 0
// bypasse complètement l'ÉTAPE 1, jamais un "et si les deux étaient combinés").
export function fromDocumentStatus(status: string): ObjectStateSignal {
  if (status === 'done') return 'COMPLETED'
  // P1-4A-D2 : `cancelled` = abandon/annulation d'une intention, JAMAIS un accomplissement.
  // Le vocabulaire de signal ne possède pas de CANCELLED ; on ne fabrique pas de faux signal et on
  // ne le mappe ni vers COMPLETED (faux accompli) ni vers OPEN/STILL_OPEN (faux « en cours ») →
  // NO_STATE_SIGNAL, l'occurrence annulée est exclue de la projection d'état du CBO.
  if (status === 'cancelled') return 'NO_STATE_SIGNAL'
  if (status === 'in_progress') return 'PROGRESS'
  if (status === 'non_compliant') return 'STILL_OPEN'
  if (status === 'awaiting_validation') return 'STILL_OPEN'
  if (status === 'planned') return 'OPENED'
  if (status === 'open') return 'STILL_OPEN'
  return 'NO_STATE_SIGNAL'
}

type EntityContext = { siteId: string; text: string; occurrenceDate: string | null }

async function loadEntityContext(
  sb: AdminClient,
  entityType: CanonicalBusinessObjectEntityType,
  entityId: string,
): Promise<EntityContext> {
  if (entityType === 'site_action') {
    const { data, error } = await sb
      .from('site_actions')
      .select('site_id, title, body, due_date')
      .eq('id', entityId)
      .maybeSingle()
    if (error) throw new Error(`lecture site_actions échouée entity=${entityId}: ${error.message}`)
    if (!data) throw new Error(`site_action introuvable entity=${entityId}`)
    return {
      siteId: data.site_id,
      text: [data.title, data.body].filter(Boolean).join('\n'),
      occurrenceDate: data.due_date,
    }
  }

  if (entityType === 'site_reserve') {
    const { data, error } = await sb
      .from('site_reserve')
      .select('site_id, label, lift_note, issued_on')
      .eq('id', entityId)
      .maybeSingle()
    if (error) throw new Error(`lecture site_reserve échouée entity=${entityId}: ${error.message}`)
    if (!data) throw new Error(`site_reserve introuvable entity=${entityId}`)
    return {
      siteId: data.site_id,
      text: [data.label, data.lift_note].filter(Boolean).join('\n'),
      occurrenceDate: data.issued_on,
    }
  }

  const { data, error } = await sb
    .from('site_deadlines')
    .select('site_id, title, constraint_text, due_date')
    .eq('id', entityId)
    .maybeSingle()
  if (error) throw new Error(`lecture site_deadlines échouée entity=${entityId}: ${error.message}`)
  if (!data) throw new Error(`site_deadline introuvable entity=${entityId}`)
  return {
    siteId: data.site_id,
    text: [data.title, data.constraint_text].filter(Boolean).join('\n'),
    occurrenceDate: data.due_date,
  }
}

// Même chaîne que attachHistoricalEntityToCanonicalBusinessObject (lib/db/canonical-business-object-attach.ts) :
// document_proposal_materialization (target_entity_type/target_entity_id) → document_extraction_proposal.document_status.
// Les occurrences créées en terrain (CR mobile) n'ont aucune matérialisation — retourne null, jamais une erreur.
async function lookupDocumentStatus(
  sb: AdminClient,
  entityType: CanonicalBusinessObjectEntityType,
  entityId: string,
): Promise<string | null> {
  const { data: mat } = await sb
    .from('document_proposal_materialization')
    .select('proposal_id')
    .eq('target_entity_type', entityType)
    .eq('target_entity_id', entityId)
    .maybeSingle()
  if (!mat) return null

  const { data: proposal } = await sb
    .from('document_extraction_proposal')
    .select('document_status')
    .eq('id', mat.proposal_id)
    .maybeSingle()
  return proposal?.document_status ?? null
}

async function lookupCanonicalBusinessObjectId(
  sb: AdminClient,
  entityType: CanonicalBusinessObjectEntityType,
  entityId: string,
): Promise<string | null> {
  const { data } = await sb
    .from('canonical_business_object_member')
    .select('canonical_business_object_id')
    .eq('member_entity_type', entityType)
    .eq('member_entity_id', entityId)
    .maybeSingle()
  return data?.canonical_business_object_id ?? null
}

/**
 * Produit (ou retraite) le signal d'état d'UNE occurrence d'objet métier — source
 * universelle (entity_type, entity_id) + texte de l'entité elle-même.
 *
 * Idempotente : une ligne déjà `resolved` n'est jamais recalculée (aucun second appel
 * LLM gaspillé). Une ligne `unresolved` (panne technique antérieure) est retentée.
 * Respecte UNIQUE(entity_type, entity_id) via upsert sur ce couple.
 *
 * Appelée en production depuis lib/db/canonical-business-object-attach.ts (H2-B.3).
 */
export async function produceObjectStateOccurrenceSignal(params: {
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
}): Promise<ProduceOccurrenceSignalOutcome> {
  const { entityType, entityId } = params
  const sb = createAdminClient()

  const { data: existing } = await sb
    .from('object_state_occurrence_signal')
    .select('id, status, final_signal, attempt_count')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle()

  if (existing?.status === 'resolved') {
    return { kind: 'skipped_already_resolved', finalSignal: existing.final_signal as ObjectStateSignal }
  }

  const context = await loadEntityContext(sb, entityType, entityId)
  const canonicalBusinessObjectId = await lookupCanonicalBusinessObjectId(sb, entityType, entityId)
  const documentStatus = await lookupDocumentStatus(sb, entityType, entityId)

  const baseRow = {
    entity_type: entityType,
    entity_id: entityId,
    site_id: context.siteId,
    canonical_business_object_id: canonicalBusinessObjectId,
    occurrence_date: context.occurrenceDate,
  }

  if (documentStatus) {
    const finalSignal = fromDocumentStatus(documentStatus)
    const { error } = await sb.from('object_state_occurrence_signal').upsert(
      {
        ...baseRow,
        status: 'resolved',
        source: 'document_status',
        step1_signal: null,
        step1_reasoning: null,
        step2_signal: null,
        step2_reasoning: null,
        final_signal: finalSignal,
        backstop_applied: false,
        backstop_reason: null,
        model: null,
        model_version: null,
        confidence: null,
        error_code: null,
        error_detail: null,
        attempt_count: existing?.attempt_count ?? 0,
        last_attempt_at: null,
        provider_request_id: null,
      },
      { onConflict: 'entity_type,entity_id' },
    )
    if (error) throw new Error(`upsert object_state_occurrence_signal (document_status) échoué entity=${entityId}: ${error.message}`)
    return { kind: 'resolved', source: 'document_status', finalSignal }
  }

  const attemptCount = (existing?.attempt_count ?? 0) + 1
  const nowIso = new Date().toISOString()
  const result = await classifyOccurrenceStateSignal(context.text)

  if (!result.ok) {
    const { error } = await sb.from('object_state_occurrence_signal').upsert(
      {
        ...baseRow,
        status: 'unresolved',
        source: 'llm',
        step1_signal: null,
        step1_reasoning: null,
        step2_signal: null,
        step2_reasoning: null,
        final_signal: null,
        backstop_applied: false,
        backstop_reason: null,
        model: process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash',
        model_version: null,
        confidence: null,
        error_code: result.errorCode,
        error_detail: result.errorDetail,
        attempt_count: attemptCount,
        last_attempt_at: nowIso,
        provider_request_id: null,
      },
      { onConflict: 'entity_type,entity_id' },
    )
    if (error) throw new Error(`upsert object_state_occurrence_signal (unresolved) échoué entity=${entityId}: ${error.message}`)
    return { kind: 'unresolved', errorCode: result.errorCode }
  }

  // final_signal = pass-through de step1_signal : le garde-fou de trajectoire (step2 +
  // backstop R1/R2) est explicitement hors périmètre H2-B.2 (mandat Vincent).
  const { error } = await sb.from('object_state_occurrence_signal').upsert(
    {
      ...baseRow,
      status: 'resolved',
      source: 'llm',
      step1_signal: result.signal,
      step1_reasoning: result.evidenceText || null,
      step2_signal: null,
      step2_reasoning: null,
      final_signal: result.signal,
      backstop_applied: false,
      backstop_reason: null,
      model: process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash',
      model_version: null,
      confidence: result.confidence,
      error_code: null,
      error_detail: null,
      attempt_count: attemptCount,
      last_attempt_at: nowIso,
      provider_request_id: null,
    },
    { onConflict: 'entity_type,entity_id' },
  )
  if (error) throw new Error(`upsert object_state_occurrence_signal (llm) échoué entity=${entityId}: ${error.message}`)
  return { kind: 'resolved', source: 'llm', finalSignal: result.signal }
}

// ── P1-4A — Cycle de vie NATIF de l'objet métier durable ─────────────────────
//
// Une clôture / réouverture EXPLICITE par l'utilisateur est une preuve de premier ordre —
// aucune inférence. On la projette sur le signal de CETTE occurrence (source distincte
// `native_action_event`), qui SUPERSÈDE le signal documentaire de la même occurrence via
// l'upsert `(entity_type, entity_id)`. `loadCboEvolutions` la voit comme le dernier signal
// significatif (occurrence_date = jour de l'événement, postérieure aux dates documentaires)
// → COMPLETED ⇒ DONE, REOPENED ⇒ REOPENED.
//
// Invariants (mandat P1-4A) :
//   - Ne touche QUE l'occurrence concernée (jamais les autres membres du CBO ni du sujet).
//   - Skip explicite si l'occurrence n'appartient à aucun CBO — AUCUN rattachement forcé.
//   - Idempotence : l'upsert par clé unique rend un double clic / retry / replay sans effet
//     de trajectoire artificielle (même ligne réécrite avec le même état).
//   - Provenance tracée par `source='native_action_event'` (distincte de `document_status`) :
//     même état DONE, mais on saura toujours qu'il vient d'une décision d'équipe, pas d'un PV.
//   - `cancel` n'appelle JAMAIS cette fonction (cancel ≠ DONE) — traité côté writer.
//   - Aucun LLM ici : MemorIA calcule, l'IA explique.
export type NativeLifecycleEvent = 'completed' | 'reopened'

export type EmitNativeLifecycleOutcome =
  | { kind: 'emitted'; finalSignal: ObjectStateSignal; canonicalBusinessObjectId: string }
  | { kind: 'skipped_no_cbo' }

export async function emitNativeActionLifecycleSignal(params: {
  entityType: CanonicalBusinessObjectEntityType
  entityId: string
  event: NativeLifecycleEvent
}): Promise<EmitNativeLifecycleOutcome> {
  const { entityType, entityId, event } = params
  const sb = createAdminClient()

  const canonicalBusinessObjectId = await lookupCanonicalBusinessObjectId(sb, entityType, entityId)
  if (!canonicalBusinessObjectId) return { kind: 'skipped_no_cbo' } // invariant : jamais de rattachement hasardeux

  const context = await loadEntityContext(sb, entityType, entityId)
  const finalSignal: ObjectStateSignal = event === 'completed' ? 'COMPLETED' : 'REOPENED'
  // Date de l'ÉVÉNEMENT (jour civil) : postérieure aux occurrences documentaires historiques,
  // donc dernier signal significatif du CBO. Un jour précis suffit à l'ordre déterministe.
  const occurrenceDate = new Date().toISOString().slice(0, 10)

  const { error } = await sb.from('object_state_occurrence_signal').upsert(
    {
      entity_type: entityType,
      entity_id: entityId,
      site_id: context.siteId,
      canonical_business_object_id: canonicalBusinessObjectId,
      occurrence_date: occurrenceDate,
      status: 'resolved',
      source: 'native_action_event',
      step1_signal: null,
      step1_reasoning: null,
      step2_signal: null,
      step2_reasoning: null,
      final_signal: finalSignal,
      backstop_applied: false,
      backstop_reason: null,
      model: null,
      model_version: null,
      confidence: null,
      error_code: null,
      error_detail: null,
      attempt_count: 0,
      last_attempt_at: null,
      provider_request_id: null,
    },
    { onConflict: 'entity_type,entity_id' },
  )
  if (error) throw new Error(`emit native lifecycle signal échoué entity=${entityId}: ${error.message}`)
  return { kind: 'emitted', finalSignal, canonicalBusinessObjectId }
}
