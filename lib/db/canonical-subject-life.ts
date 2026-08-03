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
  runId: string
  documentId: string
  effectiveDate: string
  /** Identifiant de la proposition principale (null pour les gaps). */
  proposalId: string | null
  threadId: string | null
  label: string | null
  description: string | null
  documentStatus: string | null
  proposalFamily: string | null
  thematicCategory: string | null
  sourcePage: number | null
  transition: HistoryTransition | null
  isGap: boolean
  /** Nombre de preuves (images + snapshots) liées à la proposition principale. */
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
  /** Tous les runs canoniques du chantier (axe temporel complet). */
  runs: Array<{ id: string; documentId: string; effectiveDate: string }>
  occurrences: SubjectOccurrenceMerged[]
  links: CanonicalLink[]
  materializedEvents: MaterializedEvent[]
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
    return {
      canonicalSubjectId,
      siteId,
      label: csLabel,
      aliases: csAliases,
      csStatus,
      firstSeenAt: null,
      lastSeenAt: null,
      currentStatus: null,
      primaryFamily: null,
      threadIds: [],
      pvCount: 0,
      runs: [],
      occurrences: [],
      links: [],
      materializedEvents: [],
    }
  }

  // 3. Runs canoniques du chantier (axe temporel)
  const allRuns = await canonicalRunsForSite(siteId)
  const canonicalRunIds = allRuns.map((r) => r.id)

  if (canonicalRunIds.length === 0) {
    return {
      canonicalSubjectId, siteId, label: csLabel, aliases: csAliases, csStatus,
      firstSeenAt: null, lastSeenAt: null, currentStatus: null, primaryFamily: null,
      threadIds, pvCount: 0, runs: [], occurrences: [], links: [], materializedEvents: [],
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
      threadIds, pvCount: 0,
      runs: allRuns.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) })),
      occurrences: [], links: [], materializedEvents: [],
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
        runId: run.id,
        documentId: run.document_id,
        effectiveDate,
        proposalId: null,
        threadId: null,
        label: null,
        description: null,
        documentStatus: null,
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
        runId: run.id,
        documentId: run.document_id,
        effectiveDate,
        proposalId: primary.id,
        threadId: primary.subject_thread_id,
        label: primary.label,
        description: primary.description ?? null,
        documentStatus: primary.document_status ?? null,
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

  // Stats
  const realOccurrences = occurrences.filter((o) => !o.isGap)
  const firstSeenAt = realOccurrences[0]?.effectiveDate ?? null
  const lastSeenAt = realOccurrences[realOccurrences.length - 1]?.effectiveDate ?? null
  const currentStatus = realOccurrences[realOccurrences.length - 1]?.documentStatus ?? null
  const primaryFamily = realOccurrences[0]?.proposalFamily ?? null

  // 6. Objets matérialisés (provenance exacte via document_proposal_materialization)
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

  // 7. Liens inter-threads (confirmed + suggested, pas rejected)
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
    pvCount: realOccurrences.length,
    runs: allRuns.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) })),
    occurrences,
    links,
    materializedEvents,
  }
}
