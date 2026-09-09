// P6 Live Writer — premier producteur réel (historical_pdf), câblage inerte (mandat Vincent,
// section "P6 LIVE WRITER — PREMIER PRODUCTEUR HISTORICAL_PDF").
//
// Ce module est le SEUL point qui charge des données live pour nourrir la doctrine de
// fondation pure (lib/knowledge/tracked-point-founding.ts, buildFoundingUnits) et appelle le
// writer unique (reconcileTrackedPointUnit, lib/db/tracked-point-live-writer.ts). Il ne
// duplique aucune doctrine : il construit uniquement le sous-ensemble de FoundingUnitsInput
// nécessaire au run/rapport en cours d'import, à l'identique des chargements de
// scripts/_p6d1a-preflight-global.ts (référence read-only pour la logique déjà prouvée),
// mais scopé aux seuls threads touchés par ce run — jamais tout le corpus historique du site.
//
// Provenance (§7 design + migration 400) : pour historical_pdf, sourceRefId = documents.id
// (source_document_id), résolu via document_extraction_run.document_id — jamais
// extraction_run_id ni site_report_id.
//
// Rollout : n'exécute strictement rien si isTrackedPointLiveWriterEnabledForSite(siteId) est
// false (allowlist vide par défaut dans ce lot — aucun site réel activé).
//
// Exécution séquentielle délibérée (pas de Promise.all) : la RPC sous-jacente verrouille par
// Point (FOR UPDATE), un run peut produire plusieurs unités touchant potentiellement le même
// Point candidat (D1) — la concurrence n'apporterait rien ici et compliquerait le diagnostic.
//
// Frozen — voir docs/tracked-points/p6-live-writer-design.md.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildFoundingUnits,
  type FoundingUnit,
  type FoundingUnitsInput,
  type PropRow,
} from '@/lib/knowledge/tracked-point-founding'
import { reconcileTrackedPointUnit, type ReconcileVerdict } from '@/lib/db/tracked-point-live-writer'
import type { PlanUnitContext } from '@/lib/knowledge/tracked-point-write-plan'
import type { TrackedPointCandidate } from '@/lib/knowledge/tracked-point-membership-candidates'
import { isTrackedPointLiveWriterEnabledForSite } from '@/lib/db/tracked-point-live-writer-flag'

type Db = ReturnType<typeof createAdminClient>

// ── Résolveur de sujet canonique — chargement paresseux et mis en cache, jamais tout le site. ──
// Reproduit resolveRoot (scripts/_p6d1a-preflight-global.ts:67-73) sans charger canonical_subject
// en bloc : chaque id inconnu est chargé à la demande (chaînes de fusion typiquement courtes).

type SubjectRow = { id: string; label: string; merged_into: string | null }

function makeSubjectResolver(db: Db, siteId: string) {
  const cache = new Map<string, SubjectRow>()

  async function ensureLoaded(id: string): Promise<void> {
    if (cache.has(id)) return
    const { data } = await db
      .from('canonical_subject')
      .select('id, label, merged_into')
      .eq('site_id', siteId)
      .eq('id', id)
      .maybeSingle()
    if (data) cache.set(id, data as SubjectRow)
  }

  async function resolveRoot(id: string | null): Promise<string | null> {
    if (!id) return null
    let cur = id
    const seen = new Set<string>()
    while (!seen.has(cur)) {
      seen.add(cur)
      await ensureLoaded(cur)
      const row = cache.get(cur)
      if (!row?.merged_into) return cur
      cur = row.merged_into
    }
    return cur
  }

  async function labelOf(id: string | null): Promise<string | null> {
    if (!id) return null
    await ensureLoaded(id)
    return cache.get(id)?.label ?? null
  }

  return { resolveRoot, labelOf }
}

type SubjectResolver = ReturnType<typeof makeSubjectResolver>

// ── Chargement narrow — un seul run/rapport, jamais le corpus complet du site. ────────────────

type RunFoundingInput = {
  units: FoundingUnit[]
  cboLabelById: Map<string, string>
  cboSubjectRootById: Map<string, string | null>
  threadSubjectRootById: Map<string, string | null>
  resolver: SubjectResolver
}

function resolveDate(docDate: Map<string, string | null>, documentId: string | null, createdAt: string): string {
  if (documentId) {
    const d = docDate.get(documentId)
    if (d) return d
  }
  return createdAt.slice(0, 10)
}

async function loadRunFoundingInput(db: Db, siteId: string, runId: string): Promise<RunFoundingInput | null> {
  const { data: runProps } = await db
    .from('document_extraction_proposal')
    .select('subject_thread_id')
    .eq('extraction_run_id', runId)
    .not('subject_thread_id', 'is', null)
  const threadIds = [...new Set((runProps ?? []).map((r) => r.subject_thread_id as string))]
  if (threadIds.length === 0) return null

  const { data: stiRows } = await db
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
    .in('subject_thread_id', threadIds)
  const subjectByThread = new Map(
    (stiRows ?? []).map((r) => [r.subject_thread_id as string, r.canonical_subject_id as string]),
  )

  const resolver = makeSubjectResolver(db, siteId)

  const { data: propRows } = await db
    .from('document_extraction_proposal')
    .select(
      'id, proposal_family, document_status, label, subject_thread_id, document_id, extraction_run_id, created_at, review_status, source_payload',
    )
    .in('subject_thread_id', threadIds)
  const props = (propRows ?? []) as PropRow[]

  const docIds = [...new Set(props.map((p) => p.document_id).filter((x): x is string => !!x))]
  const docDate = new Map<string, string | null>()
  if (docIds.length > 0) {
    const { data: docs } = await db.from('documents').select('id, effective_date').in('id', docIds)
    for (const d of (docs ?? []) as Array<{ id: string; effective_date: string | null }>) docDate.set(d.id, d.effective_date)
  }

  const propsByThread = new Map<string, PropRow[]>()
  for (const p of props) {
    if (!p.subject_thread_id) continue
    const l = propsByThread.get(p.subject_thread_id) ?? []
    l.push(p)
    propsByThread.set(p.subject_thread_id, l)
  }

  const threads: FoundingUnitsInput['threads'] = []
  const threadSubjectRootById = new Map<string, string | null>()
  for (const threadId of threadIds) {
    const rawSubjectId = subjectByThread.get(threadId) ?? null
    const rootSubjectId = await resolver.resolveRoot(rawSubjectId)
    threadSubjectRootById.set(threadId, rootSubjectId)
    const subjectLabel = rootSubjectId ? await resolver.labelOf(rootSubjectId) : null
    const threadProps = propsByThread.get(threadId) ?? []
    let label = subjectLabel ?? '(sujet inconnu)'
    if (threadProps.length > 0) {
      const sorted = [...threadProps].sort((a, b) => {
        const da = resolveDate(docDate, a.document_id, a.created_at)
        const dbb = resolveDate(docDate, b.document_id, b.created_at)
        return dbb.localeCompare(da) || b.created_at.localeCompare(a.created_at)
      })
      label = sorted[0].label
    }
    threads.push({ threadId, label })
  }

  // Membership CBO — même dérivation que loadFullSiteData (_p6d1a), scopée aux seules
  // propositions de ce run (jamais l'ensemble des CBO/matérialisations du site).
  const propIds = props.map((p) => p.id)
  const materializations: Array<{ proposal_id: string; target_entity_id: string; target_entity_type: string }> = []
  if (propIds.length > 0) {
    const { data } = await db
      .from('document_proposal_materialization')
      .select('proposal_id, target_entity_id, target_entity_type')
      .in('proposal_id', propIds)
    materializations.push(...((data ?? []) as typeof materializations))
  }

  const memberEntityIds = [...new Set(materializations.map((m) => m.target_entity_id))]
  const cboMembers: Array<{ canonical_business_object_id: string; member_entity_id: string; member_entity_type: string }> = []
  if (memberEntityIds.length > 0) {
    const { data } = await db
      .from('canonical_business_object_member')
      .select('canonical_business_object_id, member_entity_id, member_entity_type')
      .in('member_entity_id', memberEntityIds)
    cboMembers.push(...((data ?? []) as typeof cboMembers))
  }

  const memberKeysByProposal = new Map<string, Set<string>>()
  for (const m of materializations) {
    const key = `${m.target_entity_type}:${m.target_entity_id}`
    const s = memberKeysByProposal.get(m.proposal_id) ?? new Set<string>()
    s.add(key)
    memberKeysByProposal.set(m.proposal_id, s)
  }
  const cbosByMemberKey = new Map<string, Set<string>>()
  for (const m of cboMembers) {
    const key = `${m.member_entity_type}:${m.member_entity_id}`
    const s = cbosByMemberKey.get(key) ?? new Set<string>()
    s.add(m.canonical_business_object_id)
    cbosByMemberKey.set(key, s)
  }
  const proposalToCbos = new Map<string, Set<string>>()
  for (const [proposalId, memberKeys] of memberKeysByProposal) {
    const cboSet = new Set<string>()
    for (const mk of memberKeys) for (const cid of cbosByMemberKey.get(mk) ?? []) cboSet.add(cid)
    if (cboSet.size > 0) proposalToCbos.set(proposalId, cboSet)
  }
  const threadToCbos = new Map<string, Set<string>>()
  for (const [threadId, tprops] of propsByThread) {
    const s = new Set<string>()
    for (const p of tprops) for (const cid of proposalToCbos.get(p.id) ?? []) s.add(cid)
    if (s.size > 0) threadToCbos.set(threadId, s)
  }

  const cboIds = [...new Set([...threadToCbos.values()].flatMap((s) => [...s]))]
  const cboLabelById = new Map<string, string>()
  const cboSubjectRootById = new Map<string, string | null>()
  if (cboIds.length > 0) {
    const { data: cboRows } = await db
      .from('canonical_business_object')
      .select('id, label, canonical_subject_id')
      .in('id', cboIds)
    for (const c of (cboRows ?? []) as Array<{ id: string; label: string; canonical_subject_id: string | null }>) {
      cboLabelById.set(c.id, c.label)
      cboSubjectRootById.set(c.id, await resolver.resolveRoot(c.canonical_subject_id))
    }
  }

  const units = buildFoundingUnits({ threads, propsByThread, threadToCbos, proposalToCbos })
  return { units, cboLabelById, cboSubjectRootById, threadSubjectRootById, resolver }
}

// ── Candidats Points actifs du site — D1/protection cross-thread (Round 2, Vincent). ─────────
// Site-wide par nature (une unité PROVISIONAL peut entrer en concurrence avec un Point fondé
// par n'importe quel autre thread du site) — chargé UNIQUEMENT si au moins une unité du run est
// éligible à l'auto-création trackable_condition (cf. runTrackedPointLiveWriterForHistoricalRun).

async function loadSitePointCandidates(db: Db, siteId: string, resolver: SubjectResolver): Promise<TrackedPointCandidate[]> {
  const { data: pointRows } = await db
    .from('tracked_point')
    .select('id, label, canonical_subject_id')
    .eq('site_id', siteId)
    .eq('status', 'active')
  const points = (pointRows ?? []) as Array<{ id: string; label: string; canonical_subject_id: string | null }>
  if (points.length === 0) return []

  const pointIds = points.map((p) => p.id)
  const { data: memberRows } = await db
    .from('tracked_point_member')
    .select('tracked_point_id, subject_thread_id')
    .eq('status', 'active')
    .in('tracked_point_id', pointIds)
  const members = (memberRows ?? []) as Array<{ tracked_point_id: string; subject_thread_id: string }>

  const memberThreadIds = [...new Set(members.map((m) => m.subject_thread_id))]
  const stiMap = new Map<string, string>()
  if (memberThreadIds.length > 0) {
    const { data: stiRows } = await db
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .eq('site_id', siteId)
      .in('subject_thread_id', memberThreadIds)
    for (const r of (stiRows ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) {
      stiMap.set(r.subject_thread_id, r.canonical_subject_id)
    }
  }

  const membersByPoint = new Map<string, string[]>()
  for (const m of members) {
    const l = membersByPoint.get(m.tracked_point_id) ?? []
    l.push(m.subject_thread_id)
    membersByPoint.set(m.tracked_point_id, l)
  }

  const { data: cboRows } = await db
    .from('canonical_business_object')
    .select('id, tracked_point_id')
    .eq('site_id', siteId)
    .not('tracked_point_id', 'is', null)
  const cboByPoint = new Map<string, string[]>()
  for (const c of (cboRows ?? []) as Array<{ id: string; tracked_point_id: string }>) {
    const l = cboByPoint.get(c.tracked_point_id) ?? []
    l.push(c.id)
    cboByPoint.set(c.tracked_point_id, l)
  }

  const candidates: TrackedPointCandidate[] = []
  for (const p of points) {
    const ownerSubjectId = await resolver.resolveRoot(p.canonical_subject_id)
    const ownerSubjectLabel = ownerSubjectId ? await resolver.labelOf(ownerSubjectId) : null

    const memberLabels: string[] = []
    for (const threadId of membersByPoint.get(p.id) ?? []) {
      const rootId = await resolver.resolveRoot(stiMap.get(threadId) ?? null)
      const label = rootId ? await resolver.labelOf(rootId) : null
      if (label) memberLabels.push(label)
    }

    candidates.push({
      pointId: p.id,
      label: p.label,
      ownerSubjectId,
      ownerSubjectLabel,
      memberLabels,
      memberCboIds: cboByPoint.get(p.id) ?? undefined,
    })
  }
  return candidates
}

// ── Contexte par unité — CONFIRMED s'enracine sur le sujet du CBO, PROVISIONAL[_TRACKABLE] sur
//    le sujet propre du thread (cf. tracked-point-write-plan.ts:planPointForUnit, buildWritePlan
//    de _p6d1a lignes 414-436). Doit être calculé APRÈS buildFoundingUnits, jamais par thread. ──

async function buildUnitContext(
  u: FoundingUnit,
  cboLabelById: Map<string, string>,
  cboSubjectRootById: Map<string, string | null>,
  threadSubjectRootById: Map<string, string | null>,
  resolver: SubjectResolver,
): Promise<PlanUnitContext> {
  if (u.outcomeV2.kind === 'CONFIRMED') {
    const cboId = u.outcomeV2.cboId
    const rootId = cboSubjectRootById.get(cboId) ?? null
    return {
      cboLabel: cboLabelById.get(cboId) ?? null,
      canonicalSubjectId: rootId,
      canonicalSubjectLabel: rootId ? await resolver.labelOf(rootId) : null,
    }
  }
  if (u.outcomeV2.kind === 'PROVISIONAL' || u.outcomeV2.kind === 'PROVISIONAL_TRACKABLE') {
    const rootId = threadSubjectRootById.get(u.threadId) ?? null
    return {
      canonicalSubjectId: rootId,
      canonicalSubjectLabel: rootId ? await resolver.labelOf(rootId) : null,
    }
  }
  return {}
}

function isTrackableEligible(u: FoundingUnit): boolean {
  return u.outcomeV2.kind === 'PROVISIONAL' || u.outcomeV2.kind === 'PROVISIONAL_TRACKABLE'
}

export type HistoricalLiveWriterRunResult = {
  unitsProcessed: number
  verdictCounts: Partial<Record<ReconcileVerdict, number>>
  refusals: number
}

/**
 * Point d'entrée unique câblé par le hook de post-traitement de l'import historique
 * (lib/subjects/historical-import-post-processing.ts). Retourne `null` si le writer n'a pas
 * tourné du tout (site hors allowlist, ou run sans document_id résolu) — distinct d'un run
 * ayant tourné mais sans unité (0 thread touché).
 *
 * Best-effort côté appelant : cette fonction laisse remonter ses exceptions (l'appelant est
 * responsable du try/catch, même doctrine que resolveSiteDocumentCompletionsByProposal juste
 * après dans le même hook) — jamais un swallow silencieux ici qui masquerait une régression au
 * niveau du site déjà activé.
 */
export async function runTrackedPointLiveWriterForHistoricalRun(params: {
  runId: string
  siteId: string
}): Promise<HistoricalLiveWriterRunResult | null> {
  const { runId, siteId } = params
  if (!isTrackedPointLiveWriterEnabledForSite(siteId)) return null

  const db = createAdminClient()

  const { data: runRow } = await db
    .from('document_extraction_run')
    .select('document_id')
    .eq('id', runId)
    .maybeSingle()
  const documentId = (runRow as { document_id: string | null } | null)?.document_id ?? null
  if (!documentId) return null

  const loaded = await loadRunFoundingInput(db, siteId, runId)
  if (!loaded) return { unitsProcessed: 0, verdictCounts: {}, refusals: 0 }
  const { units, cboLabelById, cboSubjectRootById, threadSubjectRootById, resolver } = loaded

  const needsSitePoints = units.some(isTrackableEligible)
  const sitePoints = needsSitePoints ? await loadSitePointCandidates(db, siteId, resolver) : []

  const verdictCounts: Partial<Record<ReconcileVerdict, number>> = {}
  let refusals = 0

  for (const unit of units) {
    const ctx = await buildUnitContext(unit, cboLabelById, cboSubjectRootById, threadSubjectRootById, resolver)
    const result = await reconcileTrackedPointUnit({
      siteId,
      unit,
      ctx,
      sourceKind: 'historical_pdf',
      sourceRefId: documentId,
      sitePoints: isTrackableEligible(unit) ? sitePoints : undefined,
    })
    if (result.ok) {
      verdictCounts[result.verdict] = (verdictCounts[result.verdict] ?? 0) + 1
    } else {
      refusals += 1
      console.error('[tracked-point-live-writer-historical-adapter] reconcile refused:', result.error)
    }
  }

  return { unitsProcessed: units.length, verdictCounts, refusals }
}
