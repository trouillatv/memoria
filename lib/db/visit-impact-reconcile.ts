import 'server-only'

// Réconciliation des objets matérialisés après ré-analyse d'une visite.
//
// Déclencheur : fire-and-forget depuis projectAndTrace(), après projectDebriefToProposals().
//
// Périmètre V1 :
//   - site_action  : autonomie = au moins un événement humain (site_action_events, kind ≠ 'created')
//   - site_reserve : autonomie = status='lifted' OU lift_note IS NOT NULL
//   - canonical_subject_occurrence : validation_status='observed' → supprimée si orpheline
//   - Autres types (site_decision, site_watchpoint, etc.) : skip silencieux
//
// Re-rattachement (sans Gemini) :
//   1. Match exact sur dedupe_key
//   2. Fallback : même report_id, même promoted_object_type, Jaccard ≥ 0.50 sur title normalisé
//
// Invariant absolu : un objet autonome (touché par un humain) n'est jamais modifié.
//
// Limite de lot : pas de réconciliation négative (canonical_subject obsolète),
// pas de suppression d'objets. L'objet orphelin reste actif avec un marqueur.

import { createAdminClient } from '@/lib/supabase/admin'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'

const JACCARD_REATTACH_THRESHOLD = 0.5

const SUPPORTED_TYPES = new Set(['site_action', 'site_reserve'])

// ─── Point d'entrée ──────────────────────────────────────────────────────────

export interface ReconcileImpactResult {
  processed: number   // propositions supersédées avec objet matérialisé traitées
  reattached: number  // objets re-rattachés à une nouvelle proposition
  orphaned: number    // objets marqués orphelins
  autonomous: number  // objets autonomes (non touchés)
  skipped: number     // types non gérés en V1
}

/**
 * Réconcilie les impacts d'une visite après ré-analyse.
 *
 * Fire-and-forget depuis projectAndTrace() — ne doit jamais bloquer.
 * Idempotent : les objets déjà re-rattachés ou orphelins sont ignorés.
 */
export async function reconcileObsoleteProposals(params: {
  reportId: string
  siteId: string
}): Promise<ReconcileImpactResult> {
  const result: ReconcileImpactResult = {
    processed: 0, reattached: 0, orphaned: 0, autonomous: 0, skipped: 0,
  }
  const { reportId, siteId } = params
  const sb = createAdminClient()

  // 1. Propositions supersédées avec un objet matérialisé
  const { data: rawSuperseded } = await sb
    .from('site_knowledge_proposals')
    .select('id, kind, title, dedupe_key, promoted_object_id, promoted_object_type')
    .eq('report_id', reportId)
    .eq('site_id', siteId)
    .eq('status', 'superseded')
    .not('promoted_object_id', 'is', null)
    .not('promoted_object_type', 'is', null)

  const superseded = (rawSuperseded ?? []) as Array<{
    id: string
    kind: string
    title: string
    dedupe_key: string | null
    promoted_object_id: string
    promoted_object_type: string
  }>

  if (superseded.length === 0) return result

  // 2. Nouvelles propositions actives de la même visite (pour re-rattachement)
  const { data: rawActive } = await sb
    .from('site_knowledge_proposals')
    .select('id, kind, title, dedupe_key, promoted_object_id, promoted_object_type')
    .eq('report_id', reportId)
    .eq('site_id', siteId)
    .in('status', ['proposed', 'fulfilled'])

  const active = (rawActive ?? []) as Array<{
    id: string
    kind: string
    title: string
    dedupe_key: string | null
    promoted_object_id: string | null
    promoted_object_type: string | null
  }>

  // Index par dedupe_key pour le match exact
  const activeByDedupeKey = new Map<string, typeof active[0]>()
  for (const p of active) {
    if (p.dedupe_key) activeByDedupeKey.set(p.dedupe_key, p)
  }

  const now = new Date().toISOString()

  for (const stale of superseded) {
    result.processed++

    if (!SUPPORTED_TYPES.has(stale.promoted_object_type)) {
      result.skipped++
      continue
    }

    // 3. Vérifier autonomie de l'objet
    const isAuto = await isAutonomous(sb, stale.promoted_object_type, stale.promoted_object_id)
    if (isAuto) {
      result.autonomous++
      continue
    }

    // 4. Vérifier si l'objet est déjà marqué orphelin (idempotence)
    if (await isAlreadyOrphaned(sb, stale.promoted_object_type, stale.promoted_object_id)) {
      // Déjà traité, ne pas re-traiter
      continue
    }

    // 5. Chercher une proposition de remplacement
    const replacement = findReplacement(stale, active, activeByDedupeKey)

    if (replacement) {
      // Re-rattacher : la nouvelle proposition pointe vers le même objet
      await reattachObject(sb, replacement.id, stale.promoted_object_type, stale.promoted_object_id)
      // Nettoyer l'occurrence observed liée à l'ancienne proposition
      await removeObservedOccurrence(sb, stale.id)
      result.reattached++
    } else {
      // Marquer orphelin
      await markOrphaned(sb, stale.promoted_object_type, stale.promoted_object_id, now)
      // Nettoyer l'occurrence observed liée à l'ancienne proposition
      await removeObservedOccurrence(sb, stale.id)
      result.orphaned++
    }
  }

  return result
}

// ─── Autonomie ───────────────────────────────────────────────────────────────

type SupabaseAdmin = ReturnType<typeof createAdminClient>

async function isAutonomous(
  sb: SupabaseAdmin,
  objectType: string,
  objectId: string,
): Promise<boolean> {
  if (objectType === 'site_action') {
    // Autonome = au moins un événement humain autre que 'created'
    const { data } = await sb
      .from('site_action_events')
      .select('id')
      .eq('action_id', objectId)
      .neq('kind', 'created')
      .limit(1)
    return (data ?? []).length > 0
  }

  if (objectType === 'site_reserve') {
    // Autonome = levée (status='lifted') OU note de levée présente
    const { data } = await sb
      .from('site_reserve')
      .select('status, lift_note')
      .eq('id', objectId)
      .maybeSingle()
    type Row = { status?: string; lift_note?: string | null } | null
    const r = data as Row
    if (!r) return false
    return r.status === 'lifted' || (r.lift_note != null && r.lift_note.length > 0)
  }

  return false
}

async function isAlreadyOrphaned(
  sb: SupabaseAdmin,
  objectType: string,
  objectId: string,
): Promise<boolean> {
  if (objectType === 'site_action') {
    const { data } = await sb
      .from('site_actions')
      .select('orphaned_from_visit_at')
      .eq('id', objectId)
      .maybeSingle()
    type Row = { orphaned_from_visit_at?: string | null } | null
    return (data as Row)?.orphaned_from_visit_at != null
  }
  if (objectType === 'site_reserve') {
    const { data } = await sb
      .from('site_reserve')
      .select('orphaned_from_visit_at')
      .eq('id', objectId)
      .maybeSingle()
    type Row = { orphaned_from_visit_at?: string | null } | null
    return (data as Row)?.orphaned_from_visit_at != null
  }
  return false
}

// ─── Re-rattachement ─────────────────────────────────────────────────────────

function findReplacement(
  stale: { dedupe_key: string | null; promoted_object_type: string; title: string },
  active: Array<{ id: string; dedupe_key: string | null; promoted_object_id: string | null; promoted_object_type: string | null; title: string }>,
  activeByDedupeKey: Map<string, { id: string; promoted_object_id: string | null }>,
): { id: string } | null {
  // Phase 1 : match exact par dedupe_key
  if (stale.dedupe_key) {
    const exact = activeByDedupeKey.get(stale.dedupe_key)
    if (exact && !exact.promoted_object_id) return exact
  }

  // Phase 2 : Jaccard sur title, même type, sans objet déjà rattaché
  let bestScore = JACCARD_REATTACH_THRESHOLD
  let bestCandidate: { id: string } | null = null

  for (const candidate of active) {
    if (candidate.promoted_object_type !== stale.promoted_object_type) continue
    if (candidate.promoted_object_id) continue  // déjà rattaché à un objet
    const score = jaccardSimilarity(stale.title, candidate.title)
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

async function reattachObject(
  sb: SupabaseAdmin,
  newProposalId: string,
  objectType: string,
  objectId: string,
): Promise<void> {
  const table = objectType === 'site_action' ? 'site_actions' : 'site_reserve'
  // Poser le lien sur la nouvelle proposition
  await sb
    .from('site_knowledge_proposals')
    .update({ promoted_object_id: objectId, promoted_object_type: objectType })
    .eq('id', newProposalId)
  // L'objet lui-même n'est pas modifié — il garde son état actuel
  void table  // éviter l'avertissement "unused variable"
}

async function markOrphaned(
  sb: SupabaseAdmin,
  objectType: string,
  objectId: string,
  now: string,
): Promise<void> {
  const table = objectType === 'site_action' ? 'site_actions' : 'site_reserve'
  await sb
    .from(table)
    .update({
      orphaned_from_visit_at: now,
      orphaned_from_visit_reason: 'source_superseded_no_replacement',
    })
    .eq('id', objectId)
}

// ─── Occurrence canonique ─────────────────────────────────────────────────────

async function removeObservedOccurrence(
  sb: SupabaseAdmin,
  supersededProposalId: string,
): Promise<void> {
  // Supprimer les occurrences 'observed' liées à la proposition supersédée
  // (les 'confirmed' sont immunisées — action humaine explicite)
  await sb
    .from('canonical_subject_occurrence')
    .delete()
    .eq('source_proposal_id', supersededProposalId)
    .eq('validation_status', 'observed')
}
