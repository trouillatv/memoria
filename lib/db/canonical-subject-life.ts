import 'server-only'

// Vie d'un sujet — read-model pour canonical_subject
//
// Agrège l'histoire métier d'un sujet à travers tous les PV du chantier,
// quelle que soit la formulation (N subject_thread_id → 1 canonical_subject).
//
// Lecture seule. Ne modifie aucune donnée.

import { createAdminClient } from '@/lib/supabase/admin'
import { canonicalRunsForSite, runEffectiveDate, computeHistoryTransition } from '@/lib/documents/pv-history'
import type { HistoryTransition } from '@/lib/documents/pv-history'
import type { SubjectLinkType, SubjectLinkStatus } from '@/lib/db/subject-thread-links'

export type { HistoryTransition }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubjectOccurrenceMerged {
  /** 'historical_pdf' pour les extractions PV ; 'field_visit' pour les visites terrain ; 'meeting' pour les réunions. */
  sourceKind: 'historical_pdf' | 'field_visit' | 'meeting'
  runId: string | null         // null pour field_visit
  documentId: string | null    // null pour field_visit
  /** ID du rapport de visite terrain (null pour historical_pdf). */
  reportId: string | null
  effectiveDate: string
  /** Identifiant de la proposition principale (null pour les gaps). */
  proposalId: string | null
  threadId: string | null
  label: string | null
  description: string | null
  documentStatus: string | null
  /** Statut constaté terrain (field_checked / still_open / not_applicable). Null pour les PDF. */
  visitStatus: string | null
  proposalFamily: string | null
  thematicCategory: string | null
  sourcePage: number | null
  transition: HistoryTransition | null
  isGap: boolean
  /** Nombre de preuves liées. */
  evidenceCount: number
  /** Labels supplémentaires si plusieurs threads actifs dans ce run (rare). */
  additionalLabels: string[]
}

export interface CanonicalLink {
  id: string
  fromThreadId: string
  toThreadId: string
  fromCanonicalSubjectId: string | null
  toCanonicalSubjectId: string | null
  fromLabel: string
  toLabel: string
  linkType: SubjectLinkType
  status: SubjectLinkStatus
  justification: string | null
  direction: 'outgoing' | 'incoming'
}

export type MaterializedEntityType = 'site_action' | 'site_decision' | 'site_reserve' | 'site_deadline'

export interface MaterializedEvent {
  entityType: MaterializedEntityType
  entityId: string
  proposalId: string
  runId: string
  title: string
  description: string | null
  date: string | null
  status: string | null
}

export interface CanonicalSubjectLife {
  canonicalSubjectId: string
  siteId: string
  label: string
  aliases: string[]
  csStatus: string
  firstSeenAt: string | null
  lastSeenAt: string | null
  currentStatus: string | null
  primaryFamily: string | null
  threadIds: string[]
  pvCount: number
  fieldVisitCount: number
  /** Tous les runs canoniques du chantier (axe temporel complet). */
  runs: Array<{ id: string; documentId: string; effectiveDate: string }>
  occurrences: SubjectOccurrenceMerged[]
  links: CanonicalLink[]
  materializedEvents: MaterializedEvent[]
  lastMeaningfulChangeAt: string | null
  stagnationDays: number | null
  consecutiveMentionsWithoutChange: number
  isStagnant: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ProposalRow = {
  id: string
  extraction_run_id: string
  subject_thread_id: string
  proposal_family: string
  thematic_category: string | null
  label: string
  description: string | null
  document_status: string | null
  source_page: number | null
}

type RawLinkRow = {
  id: string
  site_id: string
  from_thread_id: string
  to_thread_id: string
  link_type: string
  status: string
  source: string
  confidence: number | null
  justification: string | null
  created_by: string | null
}

// ── Read-model ────────────────────────────────────────────────────────────────

/**
 * Retourne l'histoire complète d'un canonical_subject à travers tous les PV du chantier.
 *
 * Consolide N subject_thread_id en une seule timeline cohérente.
 * Retourne null si l'identifiant est inconnu.
 */
export async function getCanonicalSubjectLife(
  canonicalSubjectId: string,
): Promise<CanonicalSubjectLife | null> {
  const supabase = createAdminClient()

  // 1. Canonical subject
  const { data: cs } = await supabase
    .from('canonical_subject')
    .select('id, site_id, label, aliases, status')
    .eq('id', canonicalSubjectId)
    .maybeSingle()
  if (!cs) return null

  const siteId: string = (cs as { id: string; site_id: string; label: string; aliases: string[]; status: string }).site_id
  const csLabel: string = (cs as { label: string }).label
  const csAliases: string[] = (cs as { aliases: string[] }).aliases ?? []
  const csStatus: string = (cs as { status: string }).status

  // 2. Tous les threads rattachés à ce sujet
  const { data: stiRows } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id')
    .eq('canonical_subject_id', canonicalSubjectId)
  const threadIds: string[] = ((stiRows ?? []) as Array<{ subject_thread_id: string }>).map((r) => r.subject_thread_id)
  if (threadIds.length === 0) {
    // Sujet 100 % natif (aucun PV historique) — on cherche quand même les occurrences terrain.
    // "À corriger en V2" (note mig 291) : désormais géré ici.
    const { data: nativeCsoRows } = await supabase
      .from('canonical_subject_occurrence')
      .select('id, source_ref_id, source_proposal_id, source_kind, visit_status, label, note, evidence_count, effective_date')
      .eq('canonical_subject_id', canonicalSubjectId)
      .in('source_kind', ['field_visit', 'meeting'])
      .order('effective_date', { ascending: true })
    type NativeCsoRow = {
      id: string; source_ref_id: string; source_proposal_id: string | null
      source_kind: 'field_visit' | 'meeting'; visit_status: string | null
      label: string; note: string | null; evidence_count: number; effective_date: string
    }
    const nativeOccs: SubjectOccurrenceMerged[] = ((nativeCsoRows ?? []) as NativeCsoRow[]).map((row) => ({
      sourceKind: row.source_kind,
      runId: null, documentId: null, reportId: row.source_ref_id,
      effectiveDate: row.effective_date, proposalId: row.source_proposal_id,
      threadId: null, label: row.label, description: row.note,
      documentStatus: null, visitStatus: row.visit_status,
      proposalFamily: null, thematicCategory: null, sourcePage: null,
      transition: null, isGap: false, evidenceCount: row.evidence_count, additionalLabels: [],
    }))
    const nativeReal = nativeOccs.filter((o) => !o.isGap)
    const nativeLastSeenAt = nativeReal[nativeReal.length - 1]?.effectiveDate ?? null
    let nativeLMCA: string | null = null
    let nativeLKS: string | null = null
    let nativeCMWC = 0
    for (let i = 0; i < nativeReal.length; i++) {
      const occ = nativeReal[i]
      const st = occ.visitStatus ?? occ.documentStatus ?? null
      if (i === 0 || st !== nativeLKS) { nativeLMCA = occ.effectiveDate; nativeLKS = st; nativeCMWC = 0 }
      else { nativeCMWC++ }
    }
    const nativeStagDays = (nativeLMCA && nativeLastSeenAt && nativeLMCA !== nativeLastSeenAt)
      ? Math.floor((new Date(nativeLastSeenAt).getTime() - new Date(nativeLMCA).getTime()) / 86_400_000)
      : 0
    return {
      canonicalSubjectId, siteId, label: csLabel, aliases: csAliases, csStatus,
      firstSeenAt: nativeReal[0]?.effectiveDate ?? null,
      lastSeenAt: nativeLastSeenAt,
      currentStatus: nativeReal[nativeReal.length - 1]?.visitStatus ?? null,
      primaryFamily: null, threadIds: [],
      pvCount: 0,
      fieldVisitCount: nativeReal.filter((o) => o.sourceKind === 'field_visit' || o.sourceKind === 'meeting').length,
      runs: [], occurrences: nativeOccs, links: [], materializedEvents: [],
      lastMeaningfulChangeAt: nativeLMCA,
      stagnationDays: nativeStagDays,
      consecutiveMentionsWithoutChange: nativeCMWC,
      isStagnant: nativeStagDays >= 30 && nativeCMWC >= 2, // familles stables exclues par défaut (null = éligible)
    }
  }

  // 3. Runs canoniques du chantier (axe temporel)
  const allRuns = await canonicalRunsForSite(siteId)
  const canonicalRunIds = allRuns.map((r) => r.id)

  if (canonicalRunIds.length === 0) {
    return {
      canonicalSubjectId, siteId, label: csLabel, aliases: csAliases, csStatus,
      firstSeenAt: null, lastSeenAt: null, currentStatus: null, primaryFamily: null,
      threadIds, pvCount: 0, fieldVisitCount: 0, runs: [], occurrences: [], links: [], materializedEvents: [],
      lastMeaningfulChangeAt: null, stagnationDays: null, consecutiveMentionsWithoutChange: 0, isStagnant: false,
    }
  }

  // 4. Propositions des threads sur les runs canoniques + décompte evidence
  const [propsResult, evidResult] = await Promise.all([
    supabase
      .from('document_extraction_proposal')
      .select('id, extraction_run_id, subject_thread_id, proposal_family, thematic_category, label, description, document_status, source_page')
      .in('subject_thread_id', threadIds)
      .in('extraction_run_id', canonicalRunIds),
    supabase
      .from('document_proposal_evidence')
      .select('proposal_id'),
  ])

  const props = (propsResult.data ?? []) as ProposalRow[]

  // Map locale — aucun fetch supplémentaire
  const proposalToRun = new Map<string, string>(props.map((p) => [p.id, p.extraction_run_id]))

  // Compteur de preuves par proposition (toutes propositions du chantier — on filtrera)
  const proposalIds = props.map((p) => p.id)
  const evidenceByProposal = new Map<string, number>()
  if (proposalIds.length > 0) {
    const { data: evidRows } = await supabase
      .from('document_proposal_evidence')
      .select('proposal_id')
      .in('proposal_id', proposalIds)
    for (const ev of (evidRows ?? []) as Array<{ proposal_id: string }>) {
      evidenceByProposal.set(ev.proposal_id, (evidenceByProposal.get(ev.proposal_id) ?? 0) + 1)
    }
  }

  // 5. Construire la timeline fusionnée (une entrée par run, depuis la première occurrence)
  const propsByRun = new Map<string, ProposalRow[]>()
  for (const p of props) {
    const existing = propsByRun.get(p.extraction_run_id) ?? []
    propsByRun.set(p.extraction_run_id, [...existing, p])
  }

  const firstRunIndex = allRuns.findIndex((r) => propsByRun.has(r.id))
  if (firstRunIndex < 0) {
    return {
      canonicalSubjectId, siteId, label: csLabel, aliases: csAliases, csStatus,
      firstSeenAt: null, lastSeenAt: null, currentStatus: null, primaryFamily: null,
      threadIds, pvCount: 0, fieldVisitCount: 0,
      runs: allRuns.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) })),
      occurrences: [], links: [], materializedEvents: [],
      lastMeaningfulChangeAt: null, stagnationDays: null, consecutiveMentionsWithoutChange: 0, isStagnant: false,
    }
  }

  const relevantRuns = allRuns.slice(firstRunIndex)
  const occurrences: SubjectOccurrenceMerged[] = []
  let prevProp: ProposalRow | null = null
  let gapSinceLastOccurrence = false

  for (const run of relevantRuns) {
    const runProps = propsByRun.get(run.id) ?? []
    const effectiveDate = runEffectiveDate(run)

    if (runProps.length === 0) {
      occurrences.push({
        sourceKind: 'historical_pdf',
        runId: run.id,
        documentId: run.document_id,
        reportId: null,
        effectiveDate,
        proposalId: null,
        threadId: null,
        label: null,
        description: null,
        documentStatus: null,
        visitStatus: null,
        proposalFamily: null,
        thematicCategory: null,
        sourcePage: null,
        transition: 'non_mentionné',
        isGap: true,
        evidenceCount: 0,
        additionalLabels: [],
      })
      gapSinceLastOccurrence = true
    } else {
      // Proposition principale : priorité aux familles sémantiques (réserve, action, décision)
      const sorted = [...runProps].sort((a, b) => {
        const rank = (f: string) =>
          ['reservation', 'action', 'decision', 'deadline', 'observation', 'knowledge_fact', 'person', 'company'].indexOf(f)
        return rank(a.proposal_family) - rank(b.proposal_family)
      })
      const primary = sorted[0]
      const secondaries = sorted.slice(1)

      const isFirst = occurrences.filter((o) => !o.isGap).length === 0
      const transition: HistoryTransition | null = isFirst
        ? null
        : computeHistoryTransition(
            primary.proposal_family,
            prevProp?.document_status ?? null,
            primary.document_status,
            gapSinceLastOccurrence,
          )

      occurrences.push({
        sourceKind: 'historical_pdf',
        runId: run.id,
        documentId: run.document_id,
        reportId: null,
        effectiveDate,
        proposalId: primary.id,
        threadId: primary.subject_thread_id,
        label: primary.label,
        description: primary.description ?? null,
        documentStatus: primary.document_status ?? null,
        visitStatus: null,
        proposalFamily: primary.proposal_family,
        thematicCategory: primary.thematic_category ?? null,
        sourcePage: primary.source_page ?? null,
        transition,
        isGap: false,
        evidenceCount: evidenceByProposal.get(primary.id) ?? 0,
        additionalLabels: secondaries.map((p) => p.label),
      })
      prevProp = primary
      gapSinceLastOccurrence = false
    }
  }

  // 6. Objets matérialisés (provenance exacte via document_proposal_materialization)
  // (les stats sont calculées après la fusion PDF + terrain — voir plus bas)
  const materializedEvents: MaterializedEvent[] = []
  if (proposalIds.length > 0) {
    const { data: matRows } = await supabase
      .from('document_proposal_materialization')
      .select('proposal_id, target_entity_type, target_entity_id')
      .in('proposal_id', proposalIds)
      .in('target_entity_type', ['site_action', 'site_decision', 'site_reserve', 'site_deadline'])

    type MatRow = { proposal_id: string; target_entity_type: string; target_entity_id: string }
    const byType = new Map<string, Array<{ proposalId: string; entityId: string }>>()
    for (const m of (matRows ?? []) as MatRow[]) {
      const list = byType.get(m.target_entity_type) ?? []
      list.push({ proposalId: m.proposal_id, entityId: m.target_entity_id })
      byType.set(m.target_entity_type, list)
    }

    const fetches: PromiseLike<void>[] = []

    const actionItems = byType.get('site_action') ?? []
    if (actionItems.length > 0) {
      fetches.push(
        supabase
          .from('site_actions')
          .select('id, title, body, due_date, status')
          .in('id', actionItems.map((e) => e.entityId))
          .then(({ data }) => {
            type AR = { id: string; title: string; body: string | null; due_date: string | null; status: string }
            const byId = new Map(((data ?? []) as AR[]).map((r) => [r.id, r]))
            for (const e of actionItems) {
              const r = byId.get(e.entityId)
              if (!r) continue
              materializedEvents.push({ entityType: 'site_action', entityId: e.entityId, proposalId: e.proposalId, runId: proposalToRun.get(e.proposalId) ?? '', title: r.title, description: r.body, date: r.due_date, status: r.status })
            }
          }),
      )
    }

    const decisionItems = byType.get('site_decision') ?? []
    if (decisionItems.length > 0) {
      fetches.push(
        supabase
          .from('site_decisions')
          .select('id, titre, description, date_decision, statut')
          .in('id', decisionItems.map((e) => e.entityId))
          .then(({ data }) => {
            type DR = { id: string; titre: string; description: string | null; date_decision: string | null; statut: string | null }
            const byId = new Map(((data ?? []) as DR[]).map((r) => [r.id, r]))
            for (const e of decisionItems) {
              const r = byId.get(e.entityId)
              if (!r) continue
              materializedEvents.push({ entityType: 'site_decision', entityId: e.entityId, proposalId: e.proposalId, runId: proposalToRun.get(e.proposalId) ?? '', title: r.titre, description: r.description, date: r.date_decision, status: r.statut })
            }
          }),
      )
    }

    const reserveItems = byType.get('site_reserve') ?? []
    if (reserveItems.length > 0) {
      fetches.push(
        supabase
          .from('site_reserve')
          .select('id, label, issued_on, status')
          .in('id', reserveItems.map((e) => e.entityId))
          .then(({ data }) => {
            type RR = { id: string; label: string; issued_on: string | null; status: string }
            const byId = new Map(((data ?? []) as RR[]).map((r) => [r.id, r]))
            for (const e of reserveItems) {
              const r = byId.get(e.entityId)
              if (!r) continue
              materializedEvents.push({ entityType: 'site_reserve', entityId: e.entityId, proposalId: e.proposalId, runId: proposalToRun.get(e.proposalId) ?? '', title: r.label, description: null, date: r.issued_on, status: r.status })
            }
          }),
      )
    }

    const deadlineItems = byType.get('site_deadline') ?? []
    if (deadlineItems.length > 0) {
      fetches.push(
        supabase
          .from('site_deadlines')
          .select('id, title, constraint_text, due_date, status, source_document_effective_date')
          .in('id', deadlineItems.map((e) => e.entityId))
          .then(({ data }) => {
            type DL = { id: string; title: string; constraint_text: string | null; due_date: string | null; status: string; source_document_effective_date: string | null }
            const byId = new Map(((data ?? []) as DL[]).map((r) => [r.id, r]))
            for (const e of deadlineItems) {
              const r = byId.get(e.entityId)
              if (!r) continue
              materializedEvents.push({ entityType: 'site_deadline', entityId: e.entityId, proposalId: e.proposalId, runId: proposalToRun.get(e.proposalId) ?? '', title: r.title, description: r.constraint_text, date: r.due_date ?? r.source_document_effective_date, status: r.status })
            }
          }),
      )
    }

    await Promise.all(fetches)
  }

  // 7. Occurrences terrain (canonical_subject_occurrence, source_kind = field_visit)
  // Indépendantes du pipeline PDF — ajoutées après la timeline PV et triées par date.
  // Note V1 : si threadIds est vide (sujet sans PV historique), la fonction est déjà
  // revenue plus haut. Ce cas ne peut pas survenir en V1 (les field_visit sont toujours
  // créées sur des sujets déjà connus via PV). À corriger en V2.
  const { data: csoRows } = await supabase
    .from('canonical_subject_occurrence')
    .select('id, source_ref_id, source_proposal_id, source_kind, visit_status, label, note, evidence_count, effective_date')
    .eq('canonical_subject_id', canonicalSubjectId)
    .in('source_kind', ['field_visit', 'meeting'])
    .order('effective_date', { ascending: true })

  type CsoRow = {
    id: string
    source_ref_id: string
    source_proposal_id: string | null
    source_kind: 'field_visit' | 'meeting'
    visit_status: string | null
    label: string
    note: string | null
    evidence_count: number
    effective_date: string
  }
  for (const row of (csoRows ?? []) as CsoRow[]) {
    occurrences.push({
      sourceKind: row.source_kind,
      runId: null,
      documentId: null,
      reportId: row.source_ref_id,
      effectiveDate: row.effective_date,
      proposalId: row.source_proposal_id,
      threadId: null,
      label: row.label,
      description: row.note,
      documentStatus: null,
      visitStatus: row.visit_status,
      proposalFamily: null,
      thematicCategory: null,
      sourcePage: null,
      transition: null,
      isGap: false,
      evidenceCount: row.evidence_count,
      additionalLabels: [],
    })
  }

  // Re-trier la timeline fusionnée par date (PDF + terrain)
  occurrences.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))

  // Stats — calculées sur la timeline fusionnée complète
  const realOccurrences = occurrences.filter((o) => !o.isGap)
  const firstSeenAt = realOccurrences[0]?.effectiveDate ?? null
  const lastSeenAt = realOccurrences[realOccurrences.length - 1]?.effectiveDate ?? null
  const currentStatus = realOccurrences[realOccurrences.length - 1]?.documentStatus
    ?? realOccurrences[realOccurrences.length - 1]?.visitStatus
    ?? null
  const primaryFamily = realOccurrences[0]?.proposalFamily ?? null

  // Primitive stagnation V1B — signature combinée : statut + objets métier liés (création + changement d'état)
  const matByRunTemp = new Map<string, string[]>()
  for (const ev of materializedEvents) {
    if (!ev.runId) continue
    const list = matByRunTemp.get(ev.runId) ?? []
    list.push(`${ev.entityType}:${ev.entityId}:${ev.status ?? ''}`)
    matByRunTemp.set(ev.runId, list)
  }
  const matSigByRun = new Map<string, string>()
  for (const [runId, items] of matByRunTemp.entries()) {
    matSigByRun.set(runId, items.sort().join(';'))
  }

  let lastMeaningfulChangeAt: string | null = null
  let lastKnownSig: string | null = null
  let consecutiveMentionsWithoutChange = 0
  for (let i = 0; i < realOccurrences.length; i++) {
    const occ = realOccurrences[i]
    const statusPart = occ.visitStatus ?? occ.documentStatus ?? ''
    const matPart = occ.runId ? (matSigByRun.get(occ.runId) ?? '') : ''
    const sig = `${statusPart}|${matPart}`
    if (i === 0 || sig !== lastKnownSig) {
      lastMeaningfulChangeAt = occ.effectiveDate
      lastKnownSig = sig
      consecutiveMentionsWithoutChange = 0
    } else {
      consecutiveMentionsWithoutChange++
    }
  }
  const stagnationDays = (lastMeaningfulChangeAt && lastSeenAt && lastMeaningfulChangeAt !== lastSeenAt)
    ? Math.floor((new Date(lastSeenAt).getTime() - new Date(lastMeaningfulChangeAt).getTime()) / 86_400_000)
    : 0
  const isStagnant = !STAGNATION_INELIGIBLE.has(primaryFamily ?? '') && stagnationDays >= 30 && consecutiveMentionsWithoutChange >= 2

  // 8. Liens inter-threads (confirmed + suggested, pas rejected)
  const [outLinksRes, inLinksRes] = await Promise.all([
    supabase
      .from('subject_thread_links')
      .select('id, site_id, from_thread_id, to_thread_id, link_type, status, source, confidence, justification, created_by')
      .in('from_thread_id', threadIds)
      .neq('status', 'rejected'),
    supabase
      .from('subject_thread_links')
      .select('id, site_id, from_thread_id, to_thread_id, link_type, status, source, confidence, justification, created_by')
      .in('to_thread_id', threadIds)
      .neq('status', 'rejected'),
  ])

  const outLinks = (outLinksRes.data ?? []) as RawLinkRow[]
  const inLinks = (inLinksRes.data ?? []) as RawLinkRow[]

  // Déduplique les liens (ex. lien entre deux threads du même canonical_subject)
  const seenLinkIds = new Set<string>()
  const rawLinksWithDir: Array<RawLinkRow & { direction: 'outgoing' | 'incoming' }> = []
  for (const l of outLinks) {
    if (!seenLinkIds.has(l.id)) { seenLinkIds.add(l.id); rawLinksWithDir.push({ ...l, direction: 'outgoing' }) }
  }
  for (const l of inLinks) {
    if (!seenLinkIds.has(l.id)) { seenLinkIds.add(l.id); rawLinksWithDir.push({ ...l, direction: 'incoming' }) }
  }

  // Résoudre les canonical_subjects côté opposé
  const otherThreadIds = new Set<string>()
  for (const l of rawLinksWithDir) {
    const other = l.direction === 'outgoing' ? l.to_thread_id : l.from_thread_id
    if (!threadIds.includes(other)) otherThreadIds.add(other)
  }

  const threadToCS = new Map<string, { csId: string; csLabel: string }>()
  if (otherThreadIds.size > 0) {
    const { data: stiOther } = await supabase
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', [...otherThreadIds])

    const csIdsNeeded = new Set<string>()
    const threadToCsId = new Map<string, string>()
    for (const r of (stiOther ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) {
      threadToCsId.set(r.subject_thread_id, r.canonical_subject_id)
      csIdsNeeded.add(r.canonical_subject_id)
    }

    if (csIdsNeeded.size > 0) {
      const { data: csOtherRows } = await supabase
        .from('canonical_subject')
        .select('id, label')
        .in('id', [...csIdsNeeded])
      const csLabelMap = new Map<string, string>()
      for (const c of (csOtherRows ?? []) as Array<{ id: string; label: string }>) csLabelMap.set(c.id, c.label)

      for (const [tid, csId] of threadToCsId.entries()) {
        threadToCS.set(tid, { csId, csLabel: csLabelMap.get(csId) ?? `[${csId.slice(0, 8)}]` })
      }
    }
  }

  const links: CanonicalLink[] = rawLinksWithDir.map((l) => {
    const otherThread = l.direction === 'outgoing' ? l.to_thread_id : l.from_thread_id
    const otherCS = threadToCS.get(otherThread)
    return {
      id: l.id,
      fromThreadId: l.from_thread_id,
      toThreadId: l.to_thread_id,
      fromCanonicalSubjectId: l.direction === 'outgoing' ? canonicalSubjectId : (otherCS?.csId ?? null),
      toCanonicalSubjectId: l.direction === 'outgoing' ? (otherCS?.csId ?? null) : canonicalSubjectId,
      fromLabel: l.direction === 'outgoing' ? csLabel : (otherCS?.csLabel ?? `[${l.from_thread_id.slice(0, 8)}]`),
      toLabel: l.direction === 'outgoing' ? (otherCS?.csLabel ?? `[${l.to_thread_id.slice(0, 8)}]`) : csLabel,
      linkType: l.link_type as SubjectLinkType,
      status: l.status as SubjectLinkStatus,
      justification: l.justification,
      direction: l.direction,
    }
  })

  return {
    canonicalSubjectId,
    siteId,
    label: csLabel,
    aliases: csAliases,
    csStatus,
    firstSeenAt,
    lastSeenAt,
    currentStatus,
    primaryFamily,
    threadIds,
    pvCount: realOccurrences.filter((o) => o.sourceKind === 'historical_pdf').length,
    fieldVisitCount: realOccurrences.filter((o) => o.sourceKind === 'field_visit' || o.sourceKind === 'meeting').length,
    runs: allRuns.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) })),
    occurrences,
    links,
    materializedEvents,
    lastMeaningfulChangeAt,
    stagnationDays,
    consecutiveMentionsWithoutChange,
    isStagnant,
  }
}

/**
 * Occurrences terrain (visites + réunions) par canonical_subject_id pour un chantier.
 * Utilisé par la vue "Lignes de vie" pour les sparklines multi-sources.
 * Retourne un map : canonicalSubjectId → tableau trié par date croissante.
 */
export async function getSiteNativeOccurrencesBySubject(
  siteId: string,
): Promise<Record<string, Array<{ date: string; sourceKind: 'field_visit' | 'meeting' }>>> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, effective_date, source_kind')
    .eq('site_id', siteId)
    .in('source_kind', ['field_visit', 'meeting'])
    .order('effective_date', { ascending: true })

  type Row = { canonical_subject_id: string; effective_date: string; source_kind: 'field_visit' | 'meeting' }
  const result: Record<string, Array<{ date: string; sourceKind: 'field_visit' | 'meeting' }>> = {}
  for (const row of (data ?? []) as Row[]) {
    const list = result[row.canonical_subject_id] ?? []
    list.push({ date: row.effective_date, sourceKind: row.source_kind })
    result[row.canonical_subject_id] = list
  }
  return result
}

/** Labels de canonical_subjects par IDs — pour résoudre les sujets 100% natifs absents de la matrice PV. */
export async function getCanonicalSubjectLabelsByIds(
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('canonical_subject')
    .select('id, label')
    .in('id', ids)
  const result: Record<string, string> = {}
  for (const row of (data ?? []) as Array<{ id: string; label: string }>) {
    result[row.id] = row.label
  }
  return result
}

/**
 * Wrapper sécurisé : vérifie que le canonical_subject appartient bien au siteId
 * demandé avant de retourner les données.
 *
 * À utiliser dans le Copilote Phase 3 et partout où le canonicalSubjectId
 * est fourni par un client (et ne doit pas traverser les frontières de chantier).
 */
export async function getCanonicalSubjectLifeForSite(
  siteId: string,
  canonicalSubjectId: string,
): Promise<CanonicalSubjectLife | null> {
  const life = await getCanonicalSubjectLife(canonicalSubjectId)
  if (!life) return null
  // Refus explicite si le sujet appartient à un autre chantier
  if (life.siteId !== siteId) return null
  return life
}

// Familles dont le sujet ne peut pas "stagner" par nature (personne, entreprise, info stable).
// La stagnation ne s'applique qu'aux sujets dont on attend une évolution métier.
const STAGNATION_INELIGIBLE = new Set(['person', 'company', 'knowledge_fact'])

// ── Vue liste chantier ────────────────────────────────────────────────────────

export interface NavigableSubjectSummary {
  canonicalSubjectId: string
  title: string
  aliases: string[]
  /** Famille dominante (reservation / action / decision / …). */
  kind: string | null
  currentStatus: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  lastMeaningfulChangeAt: string | null
  pvCount: number
  threadCount: number
  nativeOccurrenceCount: number
  /** Objets métier actifs liés, ventilés par type. */
  activeObjects: {
    actionsOpen: number
    reservesOpen: number
    deadlinesActive: number
    decisionsOpen: number
    total: number
  }
  isStagnant: boolean
  stagnationDays: number
  consecutiveMentionsWithoutChange: number
}

const OPEN_NAV_STATUSES = new Set([
  'open', 'in_progress', 'still_open', 'non_compliant',
  'planned', 'awaiting_validation', 'field_checked',
])
const CLOSED_NAV_STATUSES = new Set(['done', 'cancelled', 'not_applicable'])

function navSortPriority(s: NavigableSubjectSummary): 0 | 1 | 2 | 3 {
  const isOpen = OPEN_NAV_STATUSES.has(s.currentStatus ?? '')
  if (s.isStagnant && isOpen) return 0    // à surveiller
  if (!s.isStagnant && isOpen) return 1   // en évolution active
  if (CLOSED_NAV_STATUSES.has(s.currentStatus ?? '')) return 3
  return 2                                 // informatif / statut inconnu
}

/**
 * Retourne tous les canonical_subjects navigables sur un chantier.
 *
 * Un sujet est navigable s'il possède au moins une occurrence réelle :
 * - documentaire : thread présent dans un run canonique du chantier
 * - native : entrée dans canonical_subject_occurrence (visite / réunion)
 *
 * Les deux sources alimentent la même mémoire sans mélanger leurs tables.
 * Le read-model est pré-calculé (stagnation, tri, compteurs) pour éviter
 * une deuxième refonte de requête lors de l'enrichissement de l'UI.
 */
export async function getNavigableSubjectsForSite(siteId: string): Promise<NavigableSubjectSummary[]> {
  const supabase = createAdminClient()

  // 1. Runs canoniques avec dates effectives
  const allRuns = await canonicalRunsForSite(siteId)
  const runIds = allRuns.map((r) => r.id)
  const runEffDate = new Map<string, string>(allRuns.map((r) => [r.id, runEffectiveDate(r)]))

  // 2. Propositions des runs canoniques (projection minimale)
  type PropRow = { id: string; extraction_run_id: string; subject_thread_id: string; document_status: string | null; proposal_family: string }
  let props: PropRow[] = []
  if (runIds.length > 0) {
    const { data } = await supabase
      .from('document_extraction_proposal')
      .select('id, extraction_run_id, subject_thread_id, document_status, proposal_family')
      .in('extraction_run_id', runIds)
      .not('subject_thread_id', 'is', null)
    props = (data ?? []) as PropRow[]
  }

  const allThreadIds = [...new Set(props.map((p) => p.subject_thread_id))]

  // 3. Thread → canonical_subject_id
  const threadToCsId = new Map<string, string>()
  if (allThreadIds.length > 0) {
    const { data } = await supabase
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', allThreadIds)
    for (const r of (data ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) {
      threadToCsId.set(r.subject_thread_id, r.canonical_subject_id)
    }
  }

  // 2B. Matérialisations par proposition — détection création d'objets métier (signal V1B)
  // Un nouvel objet (action/réserve/décision/échéance) apparu dans un run = évolution significative.
  type MatLightRow = { proposal_id: string; target_entity_id: string; target_entity_type: string }
  // propId → { csId, runId } — index pour éviter O(n²) dans la boucle mat
  const propMeta = new Map<string, { csId: string; runId: string }>()
  for (const p of props) {
    const csId = threadToCsId.get(p.subject_thread_id)
    if (csId) propMeta.set(p.id, { csId, runId: p.extraction_run_id })
  }
  // csId → runId → signature triée (entityType:entityId)
  const matByCsRun = new Map<string, Map<string, string>>()
  // csId → entityType → Set<entityId> — dédupliqué cross-runs (pour activeObjects)
  const csEntityIds = new Map<string, Map<string, Set<string>>>()
  if (props.length > 0) {
    const { data: matRows } = await supabase
      .from('document_proposal_materialization')
      .select('proposal_id, target_entity_id, target_entity_type')
      .in('proposal_id', props.map((p) => p.id))
      .in('target_entity_type', ['site_action', 'site_decision', 'site_reserve', 'site_deadline'])
    const rawByKey = new Map<string, string[]>()
    for (const m of (matRows ?? []) as MatLightRow[]) {
      const meta = propMeta.get(m.proposal_id)
      if (!meta) continue
      // Signature stagnation (csId × runId)
      const key = `${meta.csId}\x00${meta.runId}`
      const list = rawByKey.get(key) ?? []
      list.push(`${m.target_entity_type}:${m.target_entity_id}`)
      rawByKey.set(key, list)
      // Index entités cross-runs (pour activeObjects)
      let typeMap = csEntityIds.get(meta.csId)
      if (!typeMap) { typeMap = new Map(); csEntityIds.set(meta.csId, typeMap) }
      let idSet = typeMap.get(m.target_entity_type)
      if (!idSet) { idSet = new Set(); typeMap.set(m.target_entity_type, idSet) }
      idSet.add(m.target_entity_id)
    }
    for (const [key, items] of rawByKey.entries()) {
      const sep = key.indexOf('\x00')
      const csId = key.slice(0, sep)
      const runId = key.slice(sep + 1)
      let csMap = matByCsRun.get(csId)
      if (!csMap) { csMap = new Map(); matByCsRun.set(csId, csMap) }
      csMap.set(runId, items.sort().join(';'))
    }
  }

  // 2C. Statuts des objets métier — pour activeObjects par CS (4 requêtes parallèles légères)
  const OPEN_ACTION_STATUS   = new Set(['open', 'planned'])
  const OPEN_RESERVE_STATUS  = new Set(['open'])
  const OPEN_DEADLINE_STATUS = new Set(['to_plan', 'planned'])
  const OPEN_DECISION_STATUT = new Set(['proposee'])

  const actionStatusById   = new Map<string, string>()
  const reserveStatusById  = new Map<string, string>()
  const deadlineStatusById = new Map<string, string>()
  const decisionStatutById = new Map<string, string>()

  const allActionIds   = [...new Set([...csEntityIds.values()].flatMap(m => [...(m.get('site_action')  ?? [])]))]
  const allReserveIds  = [...new Set([...csEntityIds.values()].flatMap(m => [...(m.get('site_reserve')  ?? [])]))]
  const allDeadlineIds = [...new Set([...csEntityIds.values()].flatMap(m => [...(m.get('site_deadline') ?? [])]))]
  const allDecisionIds = [...new Set([...csEntityIds.values()].flatMap(m => [...(m.get('site_decision') ?? [])]))]

  const statusFetches: PromiseLike<void>[] = []
  if (allActionIds.length > 0) {
    statusFetches.push(supabase.from('site_actions').select('id, status').in('id', allActionIds)
      .then(({ data }) => { for (const r of (data ?? []) as Array<{ id: string; status: string }>) actionStatusById.set(r.id, r.status) }))
  }
  if (allReserveIds.length > 0) {
    statusFetches.push(supabase.from('site_reserve').select('id, status').in('id', allReserveIds)
      .then(({ data }) => { for (const r of (data ?? []) as Array<{ id: string; status: string }>) reserveStatusById.set(r.id, r.status) }))
  }
  if (allDeadlineIds.length > 0) {
    statusFetches.push(supabase.from('site_deadlines').select('id, status').in('id', allDeadlineIds)
      .then(({ data }) => { for (const r of (data ?? []) as Array<{ id: string; status: string }>) deadlineStatusById.set(r.id, r.status) }))
  }
  if (allDecisionIds.length > 0) {
    statusFetches.push(supabase.from('site_decisions').select('id, statut').in('id', allDecisionIds)
      .then(({ data }) => { for (const r of (data ?? []) as Array<{ id: string; statut: string | null }>) decisionStatutById.set(r.id, r.statut ?? '') }))
  }
  await Promise.all(statusFetches)

  // 4. Occurrences natives du chantier (visites terrain + réunions)
  type NativeRow = { canonical_subject_id: string; effective_date: string; visit_status: string | null; source_kind: string }
  const { data: nativeRaw } = await supabase
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, effective_date, visit_status, source_kind')
    .eq('site_id', siteId)
    .in('source_kind', ['field_visit', 'meeting'])
    .order('effective_date', { ascending: true })
  const nativeOccs = (nativeRaw ?? []) as NativeRow[]

  // 5. Union des CS IDs (PV canoniques ∪ natif)
  const pvCsIds = new Set([...threadToCsId.values()])
  const nativeCsIds = new Set(nativeOccs.map((o) => o.canonical_subject_id))
  const allCsIds = [...new Set([...pvCsIds, ...nativeCsIds])]
  if (allCsIds.length === 0) return []

  // 6. Métadonnées CS (actifs uniquement)
  type CsRow = { id: string; label: string; aliases: string[]; status: string }
  const { data: csRaw } = await supabase
    .from('canonical_subject')
    .select('id, label, aliases, status')
    .in('id', allCsIds)
    .eq('status', 'active')
  const csById = new Map<string, CsRow>(((csRaw ?? []) as CsRow[]).map((cs) => [cs.id, cs]))

  // 7. Pré-calculs : thread count et native count par CS
  const threadCountByCsId = new Map<string, number>()
  for (const [, csId] of threadToCsId.entries()) {
    if (csById.has(csId)) threadCountByCsId.set(csId, (threadCountByCsId.get(csId) ?? 0) + 1)
  }
  const nativeCountByCsId = new Map<string, number>()
  for (const o of nativeOccs) {
    if (csById.has(o.canonical_subject_id)) {
      nativeCountByCsId.set(o.canonical_subject_id, (nativeCountByCsId.get(o.canonical_subject_id) ?? 0) + 1)
    }
  }

  // 8. Timeline fusionnée par CS (une occurrence par CS×run, proposition dominante)
  const FAMILY_RANK = ['reservation', 'action', 'decision', 'deadline', 'observation', 'knowledge_fact', 'person', 'company']
  type OccEntry = { effectiveDate: string; status: string | null; proposalFamily: string | null; matSig: string }

  // csId → runId → {status, family} — proposition la plus sémantiquement forte
  const bestByCsRun = new Map<string, Map<string, { status: string | null; family: string }>>()
  for (const prop of props) {
    const csId = threadToCsId.get(prop.subject_thread_id)
    if (!csId || !csById.has(csId)) continue
    let runMap = bestByCsRun.get(csId)
    if (!runMap) { runMap = new Map(); bestByCsRun.set(csId, runMap) }
    const existing = runMap.get(prop.extraction_run_id)
    const newRank = FAMILY_RANK.indexOf(prop.proposal_family)
    const existingRank = existing ? FAMILY_RANK.indexOf(existing.family) : Infinity
    if (!existing || newRank < existingRank) {
      runMap.set(prop.extraction_run_id, { status: prop.document_status, family: prop.proposal_family })
    }
  }

  const occsByCsId = new Map<string, OccEntry[]>()

  // Ajouter les occurrences PV dans l'ordre chronologique des runs
  for (const [csId, runMap] of bestByCsRun.entries()) {
    const occs: OccEntry[] = []
    for (const run of allRuns) {
      const entry = runMap.get(run.id)
      if (entry) {
        occs.push({
          effectiveDate: runEffDate.get(run.id) ?? '',
          status: entry.status,
          proposalFamily: entry.family,
          matSig: matByCsRun.get(csId)?.get(run.id) ?? '',
        })
      }
    }
    occsByCsId.set(csId, occs)
  }

  // Ajouter les occurrences natives (déjà triées par date asc depuis la DB)
  for (const o of nativeOccs) {
    if (!csById.has(o.canonical_subject_id)) continue
    const existing = occsByCsId.get(o.canonical_subject_id) ?? []
    existing.push({ effectiveDate: o.effective_date, status: o.visit_status, proposalFamily: null, matSig: '' })
    occsByCsId.set(o.canonical_subject_id, existing)
  }

  // Tri final par date (nécessaire après ajout des natifs)
  for (const [csId, occs] of occsByCsId.entries()) {
    occs.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    occsByCsId.set(csId, occs)
  }

  // 9. Read-model par CS
  const results: NavigableSubjectSummary[] = []

  for (const [csId, cs] of csById.entries()) {
    const occs = occsByCsId.get(csId) ?? []
    if (occs.length === 0) continue

    // Stagnation V1B — signature combinée : statut + objets métier créés dans le run
    let lastMeaningfulChangeAt: string | null = null
    let lastKnownSig: string | null = null
    let consecutiveMentionsWithoutChange = 0
    for (let i = 0; i < occs.length; i++) {
      const occ = occs[i]
      const sig = `${occ.status ?? ''}|${occ.matSig}`
      if (i === 0 || sig !== lastKnownSig) {
        lastMeaningfulChangeAt = occ.effectiveDate
        lastKnownSig = sig
        consecutiveMentionsWithoutChange = 0
      } else {
        consecutiveMentionsWithoutChange++
      }
    }

    const firstSeenAt = occs[0].effectiveDate
    const lastSeenAt = occs[occs.length - 1].effectiveDate
    const currentStatus = occs[occs.length - 1].status ?? null
    // kind = famille la plus dominante parmi toutes les occurrences PV
    const kind = occs.find((o) => o.proposalFamily) ?.proposalFamily ?? null

    const stagnationDays = (lastMeaningfulChangeAt && lastSeenAt && lastMeaningfulChangeAt !== lastSeenAt)
      ? Math.floor((new Date(lastSeenAt).getTime() - new Date(lastMeaningfulChangeAt).getTime()) / 86_400_000)
      : 0
    const isStagnant = !STAGNATION_INELIGIBLE.has(kind ?? '') && stagnationDays >= 30 && consecutiveMentionsWithoutChange >= 2

    results.push({
      canonicalSubjectId: csId,
      title: cs.label,
      aliases: cs.aliases ?? [],
      kind,
      currentStatus,
      firstSeenAt,
      lastSeenAt,
      lastMeaningfulChangeAt,
      pvCount: bestByCsRun.get(csId)?.size ?? 0,
      threadCount: threadCountByCsId.get(csId) ?? 0,
      nativeOccurrenceCount: nativeCountByCsId.get(csId) ?? 0,
      activeObjects: (() => {
        const em = csEntityIds.get(csId)
        const actionsOpen   = [...(em?.get('site_action')  ?? [])].filter(id => OPEN_ACTION_STATUS.has(actionStatusById.get(id) ?? '')).length
        const reservesOpen  = [...(em?.get('site_reserve')  ?? [])].filter(id => OPEN_RESERVE_STATUS.has(reserveStatusById.get(id) ?? '')).length
        const deadlinesActive = [...(em?.get('site_deadline') ?? [])].filter(id => OPEN_DEADLINE_STATUS.has(deadlineStatusById.get(id) ?? '')).length
        const decisionsOpen = [...(em?.get('site_decision') ?? [])].filter(id => OPEN_DECISION_STATUT.has(decisionStatutById.get(id) ?? '')).length
        return { actionsOpen, reservesOpen, deadlinesActive, decisionsOpen, total: actionsOpen + reservesOpen + deadlinesActive + decisionsOpen }
      })(),
      isStagnant,
      stagnationDays,
      consecutiveMentionsWithoutChange,
    })
  }

  // 10. Tri : stagnants ouverts → ouverts actifs → autres → clôturés
  // À priorité égale, les objets actifs remontent (sujets avec conséquences opérationnelles > sujets cités)
  results.sort((a, b) => {
    const pa = navSortPriority(a), pb = navSortPriority(b)
    if (pa !== pb) return pa - pb
    if (pa === 0) {
      // Dans "à surveiller" : stagnation la plus longue d'abord, puis objets actifs
      if (b.stagnationDays !== a.stagnationDays) return b.stagnationDays - a.stagnationDays
      return b.activeObjects.total - a.activeObjects.total
    }
    if (pa === 1) {
      // Dans "en mouvement" : plus récent d'abord, puis objets actifs
      const byDate = (b.lastMeaningfulChangeAt ?? '').localeCompare(a.lastMeaningfulChangeAt ?? '')
      if (byDate !== 0) return byDate
      return b.activeObjects.total - a.activeObjects.total
    }
    // Autres groupes : objets actifs d'abord, puis date
    if (b.activeObjects.total !== a.activeObjects.total) return b.activeObjects.total - a.activeObjects.total
    return (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '')
  })

  return results
}
