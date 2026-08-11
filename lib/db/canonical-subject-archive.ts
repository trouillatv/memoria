import 'server-only'

// Archivage automatique des canonical_subjects sans occurrence active.
//
// Doctrine :
//   - auto_archived ≠ mort définitif : l'identité canonique est préservée.
//   - Un auto_archived peut être réactivé si une nouvelle occurrence fiable le correspond.
//   - Seuls les sujets à création automatique sont éligibles (jamais les 'manual').
//   - Un sujet avec un objet métier encore actif (non orphelin) est protégé.
//
// Appelé après reconcileSourceToCanonicalSubjects() dans le pipeline visite.

import { createAdminClient } from '@/lib/supabase/admin'

// Sources éligibles à l'archivage automatique.
// 'manual' et NULL (inconnu) sont protégés — sujet humain jamais auto-archivé.
const ARCHIVABLE_SOURCES = new Set(['auto_visit', 'auto_meeting', 'historical_pv'])

/**
 * Marque 'auto_archived' les canonical_subjects actifs qui n'ont plus d'occurrence active.
 *
 * Gardes :
 *   1. Seuls les sujets avec creation_source éligible (auto_*) sont traités.
 *   2. Un sujet avec un objet métier non orphelin (site_action/reserve/decision) est protégé.
 *   3. UPDATE conditionnel sur status='active' — idempotent.
 *
 * Retourne le nombre de sujets archivés.
 */
export async function autoArchiveOrphanedSubjects(siteId: string): Promise<number> {
  const sb = createAdminClient()

  // 1. Sujets actifs à création automatique pour ce chantier
  const { data: activeSubjects } = await sb
    .from('canonical_subject')
    .select('id, creation_source')
    .eq('site_id', siteId)
    .eq('status', 'active')

  if (!activeSubjects?.length) return 0

  const eligible = activeSubjects.filter(
    (s) => s.creation_source !== null && ARCHIVABLE_SOURCES.has(s.creation_source as string),
  )
  if (eligible.length === 0) return 0

  const eligibleIds = eligible.map((s) => s.id)

  // 2. Sujets qui ont encore au moins une occurrence active (non rejetée)
  const { data: withActiveOccs } = await sb
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id')
    .in('canonical_subject_id', eligibleIds)
    .not('validation_status', 'in', '("rejected","source_superseded")')

  const withActiveCsoSet = new Set(
    (withActiveOccs ?? []).map((r) => r.canonical_subject_id as string),
  )

  // Candidats sans occurrence active
  const candidates = eligibleIds.filter((id) => !withActiveCsoSet.has(id))
  if (candidates.length === 0) return 0

  // 3. Garde : exclure les sujets ayant un objet métier encore actif (non orphelin)
  //    Protège les sujets dont un humain a entériné l'existence via un objet promu.
  const { data: linkedProps } = await sb
    .from('site_knowledge_proposals')
    .select('canonical_subject_id, promoted_object_id, promoted_object_type')
    .in('canonical_subject_id', candidates)
    .not('promoted_object_id', 'is', null)

  const withActiveObjects = new Set<string>()

  if (linkedProps?.length) {
    const propsByType = new Map<string, Array<{ objectId: string; csId: string }>>()
    for (const p of linkedProps) {
      if (!p.promoted_object_id || !p.promoted_object_type) continue
      const list = propsByType.get(p.promoted_object_type as string) ?? []
      list.push({ objectId: p.promoted_object_id as string, csId: p.canonical_subject_id as string })
      propsByType.set(p.promoted_object_type as string, list)
    }

    // Map: object_id → canonical_subject_id (pour retrouver le CS après le fetch)
    const objectToCs = new Map<string, string>()
    for (const items of propsByType.values()) {
      for (const { objectId, csId } of items) objectToCs.set(objectId, csId)
    }

    const actionIds = (propsByType.get('site_action') ?? []).map((e) => e.objectId)
    const reserveIds = (propsByType.get('site_reserve') ?? []).map((e) => e.objectId)
    const decisionIds = (propsByType.get('site_decision') ?? []).map((e) => e.objectId)

    const [actionsRes, reservesRes, decisionsRes] = await Promise.all([
      actionIds.length > 0
        ? sb.from('site_actions').select('id').in('id', actionIds).is('orphaned_from_visit_at', null)
        : Promise.resolve({ data: [] as Array<{ id: string }> }),
      reserveIds.length > 0
        ? sb.from('site_reserve').select('id').in('id', reserveIds).is('orphaned_from_visit_at', null)
        : Promise.resolve({ data: [] as Array<{ id: string }> }),
      decisionIds.length > 0
        ? sb.from('site_decisions').select('id').in('id', decisionIds).is('orphaned_from_visit_at', null)
        : Promise.resolve({ data: [] as Array<{ id: string }> }),
    ])

    for (const row of [
      ...(actionsRes.data ?? []),
      ...(reservesRes.data ?? []),
      ...(decisionsRes.data ?? []),
    ] as Array<{ id: string }>) {
      const csId = objectToCs.get(row.id)
      if (csId) withActiveObjects.add(csId)
    }
  }

  // Sujets à archiver (sans occurrence ET sans objet actif)
  const toArchive = candidates.filter((id) => !withActiveObjects.has(id))
  if (toArchive.length === 0) return 0

  // 4. Archivage — conditionné sur status='active' (idempotent)
  await sb
    .from('canonical_subject')
    .update({ status: 'auto_archived' })
    .in('id', toArchive)
    .eq('status', 'active')

  if (toArchive.length > 0) {
    console.log(`[auto-archive] ${toArchive.length} sujet(s) archivé(s) pour le chantier ${siteId}`)
  }

  return toArchive.length
}
