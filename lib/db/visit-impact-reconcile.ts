import 'server-only'

// Réconciliation des objets matérialisés après ré-analyse d'une visite.
//
// Déclencheur : fire-and-forget depuis projectAndTrace(), après projectDebriefToProposals().
//
// Périmètre :
//   - site_action  : autonomie = au moins un événement humain (site_action_events, kind ≠ 'created')
//   - site_reserve : autonomie = status='lifted' OU lift_note IS NOT NULL
//   - site_decision: autonomie = source='human' OU statut IN ('appliquee','caduque','contredite')
//   - canonical_subject_occurrence : validation_status='observed' → supprimée si orpheline
//   - Autres types (site_watchpoint, etc.) : skip silencieux
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

const SUPPORTED_TYPES = new Set(['site_action', 'site_reserve', 'site_decision'])

// ─── Point d'entrée ──────────────────────────────────────────────────────────

export interface ReconcileImpactResult {
  processed: number        // propositions supersédées avec objet matérialisé traitées
  reattached: number       // objets re-rattachés à une nouvelle proposition
  orphaned: number         // objets marqués orphelins
  autonomous: number       // objets autonomes (non touchés)
  skipped: number          // types non gérés en V1
  csoUpdated: number       // occurrences confirmed mises à jour depuis source corrigée
  csoSourceSuperseded: number  // occurrences confirmed dont la source ne les mentionne plus
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
    csoUpdated: 0, csoSourceSuperseded: 0,
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
  const activeByDedupeKey = new Map<string, { id: string; promoted_object_id: string | null; title: string }>()
  for (const p of active) {
    if (p.dedupe_key) activeByDedupeKey.set(p.dedupe_key, { id: p.id, promoted_object_id: p.promoted_object_id, title: p.title })
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
      await reattachObject(sb, replacement, stale.promoted_object_type, stale.promoted_object_id)
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

  // Réconciliation des occurrences confirmed — indépendante des objets matérialisés ci-dessus
  const csoResult = await reconcileConfirmedOccurrences({ reportId, siteId })
  result.csoUpdated = csoResult.updated
  result.csoSourceSuperseded = csoResult.sourceSuperseded

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

  if (objectType === 'site_decision') {
    // Autonome = créée manuellement par un humain OU passée à un statut final actif
    const { data } = await sb
      .from('site_decisions')
      .select('source, statut')
      .eq('id', objectId)
      .maybeSingle()
    type Row = { source?: string | null; statut?: string | null } | null
    const r = data as Row
    if (!r) return false
    return (
      r.source === 'human' ||
      r.statut === 'appliquee' ||
      r.statut === 'caduque' ||
      r.statut === 'contredite'
    )
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
  if (objectType === 'site_decision') {
    const { data } = await sb
      .from('site_decisions')
      .select('orphaned_from_visit_at')
      .eq('id', objectId)
      .maybeSingle()
    type Row = { orphaned_from_visit_at?: string | null } | null
    return (data as Row)?.orphaned_from_visit_at != null
  }
  return false
}

// ─── Re-rattachement ─────────────────────────────────────────────────────────

/** Exportée pour les tests — pure, sans effet de bord. */
export function findReplacement(
  stale: { dedupe_key: string | null; promoted_object_type: string; title: string },
  active: Array<{ id: string; dedupe_key: string | null; promoted_object_id: string | null; promoted_object_type: string | null; title: string }>,
  activeByDedupeKey: Map<string, { id: string; promoted_object_id: string | null; title: string }>,
): { id: string; title: string } | null {
  // Phase 1 : match exact par dedupe_key
  if (stale.dedupe_key) {
    const exact = activeByDedupeKey.get(stale.dedupe_key)
    if (exact && !exact.promoted_object_id) return { id: exact.id, title: exact.title }
  }

  // Phase 2 : Jaccard sur title, même type, sans objet déjà rattaché
  let bestScore = JACCARD_REATTACH_THRESHOLD
  let bestCandidate: { id: string; title: string } | null = null

  for (const candidate of active) {
    if (candidate.promoted_object_type !== stale.promoted_object_type) continue
    if (candidate.promoted_object_id) continue  // déjà rattaché à un objet
    const score = jaccardSimilarity(stale.title, candidate.title)
    if (score > bestScore) {
      bestScore = score
      bestCandidate = { id: candidate.id, title: candidate.title }
    }
  }

  return bestCandidate
}

// Mapping objectType → table et champ titre pour la synchronisation (Lot 3)
const OBJECT_TABLE_MAP: Record<string, { table: string; titleField: string }> = {
  site_action:   { table: 'site_actions',  titleField: 'title' },
  site_reserve:  { table: 'site_reserve',  titleField: 'label' },
  site_decision: { table: 'site_decisions', titleField: 'titre' },
}

async function reattachObject(
  sb: SupabaseAdmin,
  newProposal: { id: string; title: string },
  objectType: string,
  objectId: string,
): Promise<void> {
  // Poser le lien sur la nouvelle proposition
  await sb
    .from('site_knowledge_proposals')
    .update({ promoted_object_id: objectId, promoted_object_type: objectType })
    .eq('id', newProposal.id)

  // Synchroniser le titre de l'objet si non autonome (Lot 3)
  // Seul `isAutonomous` garantit l'invariant — ici on est déjà après la vérification.
  const mapping = OBJECT_TABLE_MAP[objectType]
  if (mapping && newProposal.title) {
    await sb
      .from(mapping.table)
      .update({ [mapping.titleField]: newProposal.title })
      .eq('id', objectId)
  }
}

async function markOrphaned(
  sb: SupabaseAdmin,
  objectType: string,
  objectId: string,
  now: string,
): Promise<void> {
  const table =
    objectType === 'site_action' ? 'site_actions' :
    objectType === 'site_reserve' ? 'site_reserve' :
    'site_decisions'
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
  await sb
    .from('canonical_subject_occurrence')
    .delete()
    .eq('source_proposal_id', supersededProposalId)
    .eq('validation_status', 'observed')
}

/**
 * Réconcilie les occurrences `confirmed` dont la proposition source a été supersédée.
 *
 * Appelée depuis reconcileObsoleteProposals() APRÈS que les nouvelles occurrences
 * observed ont été créées par reconcileProposalToCanonical().
 *
 * Deux cas par occurrence confirmée :
 *
 *   1. Remplacement trouvé (même canonical_subject_id + source_kind + source_ref_id) :
 *      → Mise à jour du contenu (label/note/visit_status) + rerattachement à la nouvelle
 *        proposition + suppression du doublon observed.
 *      → effective_date inchangée. validation_status inchangée (reste 'confirmed').
 *
 *   2. Aucun remplacement (la source ne mentionne plus ce sujet) :
 *      → validation_status → 'source_superseded'. Exclue de toutes les vues d'évolution.
 *      → L'occurrence n'est pas supprimée : trace audit de ce que l'humain avait validé.
 *
 * Idempotente : une occurrence déjà 'source_superseded' ou déjà rerattachée est ignorée.
 */
export async function reconcileConfirmedOccurrences(params: {
  reportId: string
  siteId: string
}): Promise<{ updated: number; sourceSuperseded: number }> {
  const { reportId, siteId } = params
  const sb = createAdminClient()
  const now = new Date().toISOString()

  // 1. Toutes les propositions supersédées de ce rapport
  const { data: supersededRaw } = await sb
    .from('site_knowledge_proposals')
    .select('id')
    .eq('report_id', reportId)
    .eq('site_id', siteId)
    .eq('status', 'superseded')

  const supersededIds = (supersededRaw ?? []).map((p: { id: string }) => p.id)
  if (supersededIds.length === 0) return { updated: 0, sourceSuperseded: 0 }

  // 2. Occurrences confirmed liées à ces propositions
  const { data: confirmedRaw } = await sb
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_kind, source_proposal_id')
    .in('source_proposal_id', supersededIds)
    .eq('validation_status', 'confirmed')

  const confirmed = (confirmedRaw ?? []) as Array<{
    id: string
    canonical_subject_id: string
    source_kind: string
    source_proposal_id: string
  }>
  if (confirmed.length === 0) return { updated: 0, sourceSuperseded: 0 }

  // 3. Nouvelles occurrences observed créées par la ré-analyse du même rapport
  //    Filtre : même source_ref_id (rapport), mêmes canonical_subject_ids
  const canonicalIds = confirmed.map((o) => o.canonical_subject_id)
  const { data: replacementsRaw } = await sb
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_kind, source_proposal_id, label, note, visit_status')
    .eq('source_ref_id', reportId)
    .in('canonical_subject_id', canonicalIds)
    .eq('validation_status', 'observed')

  type ReplacementRow = {
    id: string; canonical_subject_id: string; source_kind: string
    source_proposal_id: string; label: string; note: string | null; visit_status: string | null
  }

  // Index : (canonical_subject_id + ':' + source_kind) → première occurrence observed
  const replacementMap = new Map<string, ReplacementRow>()
  for (const r of (replacementsRaw ?? []) as ReplacementRow[]) {
    const key = `${r.canonical_subject_id}:${r.source_kind}`
    if (!replacementMap.has(key)) replacementMap.set(key, r)
  }

  let updated = 0
  let sourceSuperseded = 0

  for (const occ of confirmed) {
    const key = `${occ.canonical_subject_id}:${occ.source_kind}`
    const replacement = replacementMap.get(key)

    if (replacement) {
      // Mise à jour du contenu confirmed + rerattachement à la nouvelle proposition
      await sb
        .from('canonical_subject_occurrence')
        .update({
          label: replacement.label,
          note: replacement.note,
          visit_status: replacement.visit_status,
          source_proposal_id: replacement.source_proposal_id,
          updated_at: now,
        })
        .eq('id', occ.id)

      // Suppression du doublon observed (fusionné dans le confirmed)
      await sb
        .from('canonical_subject_occurrence')
        .delete()
        .eq('id', replacement.id)
        .eq('validation_status', 'observed')

      updated++
    } else {
      // La source ne mentionne plus ce sujet — marquer source_superseded
      await sb
        .from('canonical_subject_occurrence')
        .update({ validation_status: 'source_superseded', updated_at: now })
        .eq('id', occ.id)
        .eq('validation_status', 'confirmed')   // garde-fou idempotence

      sourceSuperseded++
    }
  }

  return { updated, sourceSuperseded }
}
