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
    }
  }

  // 3. Runs canoniques du chantier (axe temporel)
  const allRuns = await canonicalRunsForSite(siteId)
  const canonicalRunIds = allRuns.map((r) => r.id)

  if (canonicalRunIds.length === 0) {
    return {
      canonicalSubjectId, siteId, label: csLabel, aliases: csAliases, csStatus,
      firstSeenAt: null, lastSeenAt: null, currentStatus: null, primaryFamily: null,
      threadIds, pvCount: 0, runs: [], occurrences: [], links: [],
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
      occurrences: [], links: [],
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

  // 6. Liens inter-threads (confirmed + suggested, pas rejected)
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
  }
}
