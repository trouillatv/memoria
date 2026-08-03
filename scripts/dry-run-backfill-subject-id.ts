/**
 * Dry-run : état du rattachement subject_id sur les objets historiques.
 *
 * Chaîne de provenance possible :
 *   site_action / site_decision / site_reserve / site_deadline
 *     → document_proposal_materialization (target_entity_type + target_entity_id)
 *     → document_extraction_proposal (subject_thread_id)
 *     → subject_thread_identity (canonical_subject_id)
 *     → canonical_subject (label, site_id)
 *     ??? → subjects (name, site_id) — GAP : tables distinctes sans FK pont
 *
 * Ce script donne par type d'objet :
 *   - total historiques (created_from = 'historical_import')
 *   - sans subject_id
 *   - traçables jusqu'au canonical_subject (provenance certaine)
 *   - parmi ceux-là : nombre où canonical_subject.label = subjects.name (même chantier)
 *   - ambigus (plusieurs subjects.id candidats pour le même label)
 *   - sans match dans subjects
 *
 * Aucune écriture. READ ONLY.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type ObjectType = 'site_action' | 'site_reserve' | 'site_decision' | 'site_deadline'

interface TypeStat {
  entityType: ObjectType
  totalHistorical: number
  withoutSubjectId: number
  traceableToCanonical: number
  exactLabelMatch: number
  ambiguous: number
  noMatchInSubjects: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ENTITY_TABLE: Record<ObjectType, string> = {
  site_action:   'site_actions',
  site_reserve:  'site_reserve',
  site_decision: 'site_decisions',
  site_deadline: 'site_deadlines',
}

async function runForType(entityType: ObjectType): Promise<TypeStat> {
  const table = ENTITY_TABLE[entityType]

  // 1. Total historiques
  const { count: totalHistorical } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('created_from', 'historical_import')
    .is('deleted_at', null)

  // 2. Sans subject_id
  const { count: withoutSubjectId } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('created_from', 'historical_import')
    .is('subject_id', null)
    .is('deleted_at', null)

  if (!withoutSubjectId) {
    return { entityType, totalHistorical: totalHistorical ?? 0, withoutSubjectId: 0, traceableToCanonical: 0, exactLabelMatch: 0, ambiguous: 0, noMatchInSubjects: 0 }
  }

  // 3. Tous les objets sans subject_id
  const { data: entityRows } = await supabase
    .from(table)
    .select('id, site_id')
    .eq('created_from', 'historical_import')
    .is('subject_id', null)
    .is('deleted_at', null)
    .limit(5000)

  const entityIds = (entityRows ?? []).map((r) => (r as { id: string }).id)
  const entitySiteMap = new Map((entityRows ?? []).map((r) => {
    const row = r as { id: string; site_id: string | null }
    return [row.id, row.site_id]
  }))

  if (entityIds.length === 0) {
    return { entityType, totalHistorical: totalHistorical ?? 0, withoutSubjectId: 0, traceableToCanonical: 0, exactLabelMatch: 0, ambiguous: 0, noMatchInSubjects: 0 }
  }

  // 4. Tracer via document_proposal_materialization → proposal → subject_thread_id
  const { data: matRows } = await supabase
    .from('document_proposal_materialization')
    .select('target_entity_id, proposal_id')
    .eq('target_entity_type', entityType)
    .in('target_entity_id', entityIds)

  const entityToProposalId = new Map<string, string>(
    (matRows ?? []).map((r) => {
      const row = r as { target_entity_id: string; proposal_id: string }
      return [row.target_entity_id, row.proposal_id]
    })
  )

  const proposalIds = [...new Set(entityToProposalId.values())]
  if (proposalIds.length === 0) {
    return { entityType, totalHistorical: totalHistorical ?? 0, withoutSubjectId: withoutSubjectId ?? 0, traceableToCanonical: 0, exactLabelMatch: 0, ambiguous: 0, noMatchInSubjects: 0 }
  }

  // 5. subject_thread_id sur les proposals
  const { data: propRows } = await supabase
    .from('document_extraction_proposal')
    .select('id, subject_thread_id')
    .in('id', proposalIds)
    .not('subject_thread_id', 'is', null)

  const proposalToThread = new Map<string, string>(
    (propRows ?? []).map((r) => {
      const row = r as { id: string; subject_thread_id: string }
      return [row.id, row.subject_thread_id]
    })
  )

  // Associer entity → thread_id
  const entityToThread = new Map<string, string>()
  for (const [entityId, proposalId] of entityToProposalId) {
    const threadId = proposalToThread.get(proposalId)
    if (threadId) entityToThread.set(entityId, threadId)
  }

  const threadIds = [...new Set(entityToThread.values())]
  if (threadIds.length === 0) {
    return { entityType, totalHistorical: totalHistorical ?? 0, withoutSubjectId: withoutSubjectId ?? 0, traceableToCanonical: 0, exactLabelMatch: 0, ambiguous: 0, noMatchInSubjects: 0 }
  }

  // 6. canonical_subject via subject_thread_identity
  const { data: stiRows } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', threadIds)

  const threadToCanonical = new Map<string, string>(
    (stiRows ?? []).map((r) => {
      const row = r as { subject_thread_id: string; canonical_subject_id: string }
      return [row.subject_thread_id, row.canonical_subject_id]
    })
  )

  // Compter les entités traçables jusqu'au canonical
  const traceableEntities = entityIds.filter((id) => {
    const thread = entityToThread.get(id)
    return thread && threadToCanonical.has(thread)
  })
  const traceableToCanonical = traceableEntities.length

  if (traceableToCanonical === 0) {
    return { entityType, totalHistorical: totalHistorical ?? 0, withoutSubjectId: withoutSubjectId ?? 0, traceableToCanonical: 0, exactLabelMatch: 0, ambiguous: 0, noMatchInSubjects: 0 }
  }

  // 7. Labels des canonical_subjects concernés
  const canonicalIds = [...new Set(traceableEntities.map((id) => {
    const thread = entityToThread.get(id)!
    return threadToCanonical.get(thread)!
  }))]

  const { data: csRows } = await supabase
    .from('canonical_subject')
    .select('id, label, site_id')
    .in('id', canonicalIds)

  const canonicalMap = new Map<string, { label: string; siteId: string }>(
    (csRows ?? []).map((r) => {
      const row = r as { id: string; label: string; site_id: string }
      return [row.id, { label: row.label, siteId: row.site_id }]
    })
  )

  // 8. Chercher les subjects correspondants (label exact, même chantier)
  //    Grouper par (label.toLowerCase(), site_id) pour détecter les ambigus
  const siteIds = [...new Set(canonicalIds.map((csId) => canonicalMap.get(csId)?.siteId).filter(Boolean) as string[])]
  const labels  = [...new Set(canonicalIds.map((csId) => canonicalMap.get(csId)?.label).filter(Boolean) as string[])]

  const { data: subjRows } = await supabase
    .from('subjects')
    .select('id, name, site_id')
    .in('site_id', siteIds)
    .in('name', labels)
    .neq('status', 'closed')

  // (label.lower, site_id) → [subject_id, ...]
  const labelSiteToSubjectIds = new Map<string, string[]>()
  for (const r of (subjRows ?? []) as Array<{ id: string; name: string; site_id: string }>) {
    const key = `${r.name.toLowerCase()}|${r.site_id}`
    if (!labelSiteToSubjectIds.has(key)) labelSiteToSubjectIds.set(key, [])
    labelSiteToSubjectIds.get(key)!.push(r.id)
  }

  let exactLabelMatch = 0
  let ambiguous = 0
  let noMatchInSubjects = 0

  for (const entityId of traceableEntities) {
    const thread   = entityToThread.get(entityId)!
    const csId     = threadToCanonical.get(thread)!
    const cs       = canonicalMap.get(csId)
    const siteId   = cs?.siteId ?? entitySiteMap.get(entityId) ?? null
    if (!cs || !siteId) { noMatchInSubjects++; continue }

    const key      = `${cs.label.toLowerCase()}|${siteId}`
    const candidates = labelSiteToSubjectIds.get(key) ?? []
    if      (candidates.length === 1) exactLabelMatch++
    else if (candidates.length > 1)   ambiguous++
    else                              noMatchInSubjects++
  }

  return {
    entityType,
    totalHistorical: totalHistorical ?? 0,
    withoutSubjectId: withoutSubjectId ?? 0,
    traceableToCanonical,
    exactLabelMatch,
    ambiguous,
    noMatchInSubjects,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const types: ObjectType[] = ['site_action', 'site_decision', 'site_reserve', 'site_deadline']
  const stats: TypeStat[] = []

  for (const t of types) {
    process.stdout.write(`  ${t}… `)
    const s = await runForType(t)
    stats.push(s)
    console.log('ok')
  }

  console.log('\n── Dry-run backfill subject_id (objets historiques) ──────────────────────')
  console.log('Type             | Total hist | Sans subj | Traçable→CS | Match exact | Ambigu | Introuvable')
  console.log('-----------------|------------|-----------|-------------|-------------|--------|------------')
  for (const s of stats) {
    const pct = s.withoutSubjectId > 0 ? `${Math.round(s.traceableToCanonical / s.withoutSubjectId * 100)}%` : 'n/a'
    console.log(
      `${s.entityType.padEnd(16)} | ${String(s.totalHistorical).padStart(10)} | ${String(s.withoutSubjectId).padStart(9)} | ${String(s.traceableToCanonical).padStart(11)} (${pct}) | ${String(s.exactLabelMatch).padStart(11)} | ${String(s.ambiguous).padStart(6)} | ${String(s.noMatchInSubjects).padStart(11)}`
    )
  }

  // ── Note architecturale ─────────────────────────────────────────────────
  console.log(`
ARCHITECTURE :
  La chaîne mène à canonical_subject.id, pas à subjects.id.
  Ces deux tables n'ont pas de FK pont.
  "Match exact" = canonical_subject.label === subjects.name (même site_id, non clos).
  Ambiguïté = plusieurs subjects candidats pour le même label sur le même chantier.
  `)

  // ── Exemples OCEF ─────────────────────────────────────────────────────────
  console.log('── Exemples OCEF (R4, G3, Débourbeur, Lagunage, Couche de forme) ──────────')

  const ocefLabels = ['R4', 'G3', 'Débourbeur', 'Lagunage', 'Couche de forme']

  const { data: ocefSubjects } = await supabase
    .from('subjects')
    .select('id, name, site_id, status, sites(name)')
    .in('name', [...ocefLabels, ...ocefLabels.map(l => l.toLowerCase())])

  const { data: ocefCanonical } = await supabase
    .from('canonical_subject')
    .select('id, label, site_id, status')
    .or(ocefLabels.map(l => `label.ilike.%${l}%`).join(','))

  console.log('\nSubjects (table subjects) :')
  for (const r of (ocefSubjects ?? []) as Array<{ id: string; name: string; site_id: string; status: string; sites: { name: string } | null }>) {
    console.log(`  [${r.status}] ${r.name} (site: ${r.sites?.name ?? r.site_id}) → subjects.id ${r.id}`)
  }

  console.log('\nCanonical subjects (table canonical_subject) :')
  for (const r of (ocefCanonical ?? []) as Array<{ id: string; label: string; site_id: string; status: string }>) {
    console.log(`  [${r.status}] ${r.label} (site: ${r.site_id}) → canonical_subject.id ${r.id}`)
  }

  // Vérifier si canonical_subject.id = subjects.id pour ces labels
  const csIds = new Set((ocefCanonical ?? []).map((r: { id: string }) => r.id))
  const subjIds = new Set((ocefSubjects ?? []).map((r: { id: string }) => r.id))
  const overlap = [...csIds].filter(id => subjIds.has(id))
  if (overlap.length > 0) {
    console.log(`\n  ⚠ ${overlap.length} IDs identiques entre canonical_subject et subjects (tables non indépendantes ?)`)
  } else {
    console.log('\n  Aucun ID commun — tables bien indépendantes.')
  }
}

main().catch(console.error)
