import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { CanonicalBusinessObjectEntry } from '@/lib/knowledge/canonical-business-object-projection'
import type { MaterializedEntityType } from '@/lib/db/canonical-subject-life'
import type { ObjectStateSignal } from '@/lib/ai/classify-occurrence-state-signal'
import {
  reduceCboLifecycle, deriveCboNature, assembleCboEvents, deriveCanonicalSubjectCboState,
  type CboReducedState, type CboMemberProvenance, type CboCompletionProof, type CboNativeJournalEvent,
  type SubjectCboState,
} from '@/lib/knowledge/cbo-lifecycle-reducer'
import { loadProposalProofs, ACTIVE_POLICY_VERSION } from '@/lib/knowledge/document-completion-resolver'
import { getEffectiveResolutionByProposal, computeProofContextFingerprint } from '@/lib/db/document-completion-resolution'

// Read-model de trajectoire longitudinale par CBO — P1-C2B.4 H2-B.4UI.
//
// Mandat Vincent (2026-08-25, après H2-B.4 : 78/78 signaux OCEF+PETRO backfillés) :
// lecture PURE des lignes déjà persistées dans object_state_occurrence_signal — aucune
// écriture, aucun appel Gemini déclenché par l'ouverture de la page (cf. doctrine de la
// table, migration 349 : "la trajectoire du CBO reste une fonction pure, recalculée à la
// demande à partir de ces lignes").
//
// Réduction longitudinale : même forme algorithmique que
// docs/memory-longitudinal-v1/P1-C2B4-STATE-CLASSIFICATION-DESIGN.md /
// scripts/p1c2b4e-longitudinal-state-recalc.ts (buckets OPEN_LIKE/PROGRESSING/REALIZED,
// détection de régression après un état réalisé, desync = calculé DONE vs statut structuré
// resté ouvert) — mais appliquée au nouveau vocabulaire de signal (object_state_occurrence_signal),
// pas au vocabulaire document_status. Contrairement à ce script, aucune résolution de scope
// de preuve n'est nécessaire ici : chaque ligne de signal est déjà adressée sans ambiguïté
// par (entity_type, entity_id), donc pas de verdict UNKNOWN/CONTRADICTED-par-scope.
//
// Hors périmètre volontaire : les 36 NO_CBO de H2-B.4 n'ont jamais de ligne de signal
// (canonical_business_object_id requis pour être interrogé ici) — rien à exclure explicitement,
// l'absence de CBO les exclut structurellement.

export type CboComputedState = 'OPEN' | 'PROGRESSING' | 'DONE' | 'REOPENED' | 'CONTRADICTED' | 'NO_SIGNAL'

export type CboSignalOccurrence = {
  entityId: string
  entityType: MaterializedEntityType
  occurrenceDate: string | null
  finalSignal: ObjectStateSignal
  // P1-4A : 'native_action_event' = clôture/réouverture explicite de l'utilisateur (preuve de
  // premier ordre). La réduction n'utilise pas `source` (seul finalSignal+date comptent) ; ce
  // champ ne sert qu'à la provenance affichée. Ouvert pour les canaux futurs (P1-4B documentaire).
  source: string
  reasoning: string | null
}

export type CboEvolution = {
  computedState: CboComputedState
  lastMeaningfulEvolutionAt: string | null
  occurrenceCount: number
  structuredStatusDesync: boolean
  trajectory: CboSignalOccurrence[]
}

type SignalBucket = 'OPEN_LIKE' | 'PROGRESSING' | 'REALIZED'

function bucketOfSignal(signal: ObjectStateSignal): SignalBucket | null {
  if (signal === 'OPENED' || signal === 'STILL_OPEN' || signal === 'REOPENED') return 'OPEN_LIKE'
  if (signal === 'PROGRESS') return 'PROGRESSING'
  if (signal === 'COMPLETED') return 'REALIZED'
  return null // NO_STATE_SIGNAL — pas de bucket, exclu du calcul en amont
}

function bucketOfPhysicalStatus(status: string | null): SignalBucket | null {
  if (!status) return null
  if (status === 'cancelled') return null // D2 : annulation ≠ réalisation (exclue de la baseline, jamais REALIZED)
  if (status === 'done' || status === 'lifted' || status === 'informational') return 'REALIZED'
  if (status === 'in_progress') return 'PROGRESSING'
  if (status === 'open' || status === 'planned' || status === 'non_compliant' || status === 'awaiting_validation' || status === 'to_plan' || status === 'still_open') return 'OPEN_LIKE'
  return null
}

/** Baseline structurée d'un CBO : DONE seulement si TOUS les membres connus sont réalisés (même règle que p1c2b4e). */
function physicalBaselineOf(statuses: (string | null)[]): SignalBucket | null {
  const known = statuses.map(bucketOfPhysicalStatus).filter((b): b is SignalBucket => b !== null)
  if (known.length === 0) return null
  return known.every((b) => b === 'REALIZED') ? 'REALIZED' : 'OPEN_LIKE'
}

/**
 * Réduction pure — état calculé à partir des occurrences significatives (NO_STATE_SIGNAL
 * déjà exclu), triées chronologiquement ascendant. Détecte la régression (REOPENED) et la
 * contradiction (deux buckets opposés à la même date), même logique que scripts/p1c2b4e.
 */
function computeState(meaningful: CboSignalOccurrence[]): CboComputedState {
  if (meaningful.length === 0) return 'NO_SIGNAL'

  const last = meaningful[meaningful.length - 1]
  if (last.finalSignal === 'REOPENED') return 'REOPENED'

  const lastBucket = bucketOfSignal(last.finalSignal)!
  let candidate: CboComputedState = lastBucket === 'REALIZED' ? 'DONE' : lastBucket === 'PROGRESSING' ? 'PROGRESSING' : 'OPEN'

  const lastRealizedIdx = [...meaningful]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find((x) => bucketOfSignal(x.m.finalSignal) === 'REALIZED')?.i ?? -1
  if (lastRealizedIdx >= 0 && lastRealizedIdx < meaningful.length - 1) candidate = 'REOPENED'

  const lastDate = last.occurrenceDate
  if (lastDate) {
    const sameDateBuckets = new Set(
      meaningful.filter((m) => m.occurrenceDate === lastDate).map((m) => bucketOfSignal(m.finalSignal)),
    )
    if (sameDateBuckets.size > 1 && sameDateBuckets.has('REALIZED') && (sameDateBuckets.has('OPEN_LIKE') || sameDateBuckets.has('PROGRESSING'))) {
      candidate = 'CONTRADICTED'
    }
  }
  return candidate
}

function sortByOccurrenceDate<T extends { occurrenceDate: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.occurrenceDate && b.occurrenceDate) return a.occurrenceDate.localeCompare(b.occurrenceDate)
    if (a.occurrenceDate) return -1
    if (b.occurrenceDate) return 1
    return 0
  })
}

// Un .in() sur des centaines d'UUID dépasse la limite de headers HTTP du client PostgREST —
// même contrainte que fetchCboMemberships (canonical-business-object-projection.ts).
const CHUNK_SIZE = 100

type SignalRow = {
  canonical_business_object_id: string
  entity_type: string
  entity_id: string
  occurrence_date: string | null
  final_signal: string
  source: string
  step1_reasoning: string | null
}

/**
 * Charge la trajectoire de signal de chaque CBO regroupé parmi les entrées fournies.
 * N'interroge QUE les CBO déjà identifiés côté page (entry.isGrouped) — un CBO sans
 * canonical_business_object_id (NO_CBO) n'entre jamais dans cette fonction. Lecture seule
 * stricte (SELECT uniquement), aucun appel IA.
 */
export async function loadCboEvolutions(
  entries: CanonicalBusinessObjectEntry[],
): Promise<Map<string, CboEvolution>> {
  const cboIds = entries.filter((e) => e.isGrouped).map((e) => e.key)
  const result = new Map<string, CboEvolution>()
  if (cboIds.length === 0) return result

  const sb = createAdminClient()
  const rows: SignalRow[] = []
  for (let i = 0; i < cboIds.length; i += CHUNK_SIZE) {
    const chunk = cboIds.slice(i, i + CHUNK_SIZE)
    const { data, error } = await sb
      .from('object_state_occurrence_signal')
      .select('canonical_business_object_id, entity_type, entity_id, occurrence_date, final_signal, source, step1_reasoning')
      .in('canonical_business_object_id', chunk)
      .eq('status', 'resolved')
    if (error) throw new Error(`loadCboEvolutions: échec du chunk [${i}, ${i + chunk.length}) — ${error.message}`)
    rows.push(...((data ?? []) as SignalRow[]))
  }

  const byCbo = new Map<string, SignalRow[]>()
  for (const r of rows) {
    const list = byCbo.get(r.canonical_business_object_id) ?? []
    list.push(r)
    byCbo.set(r.canonical_business_object_id, list)
  }

  const memberTitleByEntity = new Map<string, string>()
  const statusesByEntry = new Map<string, (string | null)[]>()
  for (const e of entries) {
    if (!e.isGrouped) continue
    statusesByEntry.set(e.key, e.members.map((m) => m.status))
    for (const m of e.members) memberTitleByEntity.set(`${m.entityType}:${m.entityId}`, m.title)
  }

  for (const cboId of cboIds) {
    const signalRows = byCbo.get(cboId) ?? []
    const trajectory = sortByOccurrenceDate(
      signalRows.map((r) => ({
        entityId: r.entity_id,
        entityType: r.entity_type as MaterializedEntityType,
        occurrenceDate: r.occurrence_date,
        finalSignal: r.final_signal as ObjectStateSignal,
        source: r.source,
        reasoning: r.step1_reasoning ?? memberTitleByEntity.get(`${r.entity_type}:${r.entity_id}`) ?? null,
      })),
    )

    const meaningful = trajectory.filter((t) => t.finalSignal !== 'NO_STATE_SIGNAL')
    const computedState = computeState(meaningful)
    const lastMeaningful = meaningful[meaningful.length - 1] ?? null

    const structuredStatusDesync =
      computedState === 'DONE' && physicalBaselineOf(statusesByEntry.get(cboId) ?? []) === 'OPEN_LIKE'

    result.set(cboId, {
      computedState,
      lastMeaningfulEvolutionAt: lastMeaningful?.occurrenceDate ?? null,
      occurrenceCount: trajectory.length,
      structuredStatusDesync,
      trajectory,
    })
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// P1-4C2A (INTEGRATION + DOC-OPEN) — réducteur CBO UNIQUE branché sur les sources AUTORITATIVES.
//
// Compose DEUX sources, par date MÉTIER uniquement :
//   1. DOCUMENTAIRE (inférence révisable), toute CBO-scopée par le membership déjà décidé :
//      - doc_open(T) = chaque MEMBRE site_action du CBO (canonical_business_object_member), daté par
//        la date métier de son document source (report → source_document → effective_date). L'identité
//        est fournie par le membership ; aucun matching lexical/subject-wide/LLM/resolver.
//      - documentary_completion(T) = résolutions B EFFECTIVES (MATCH/HIGH, policy active), datées par la
//        date du document de la preuve, PUIS filtrées par la qualification DÉTERMINISTE C1C : seule une
//        intention one_shot + terminal_candidate complète (Test SSI/RIA/Allée/« Mettre en place un
//        SSIAP » ne complètent jamais).
//      - RÈGLE DE PROVENANCE (même document) : un membre dont source_document_id est l'un des documents
//        fournissant la complétion retenue du CBO n'est PAS ré-émis en doc_open — le PV qui CLÔTURE ne
//        doit pas produire simultanément doc_open(T)+doc_completion(T) → faux CONFLICT (cas Éclairage).
//   2. NATIVE (autoritative) : journal `site_action_events`. `completed`/`reopened`/`cancelled`/
//      `progress` = événements natifs datés (`occurred_at`) ; les terminaux verrouillent (le documentaire
//      ne les renverse jamais). `created` est EXCLU de la réduction : son occurred_at est l'horloge
//      d'IMPORT (date technique), pas une date métier — il reste dans le journal mais n'entre pas ici.
//
// Population/inventaire = canonical_business_object_member (pas l'existence d'un ancien signal). Un
// membership DANGLING (member_entity_id sans site_action vivant) est ignoré ; sans autre preuve →
// unknown. Aucune réparation de données dans ce lot.
//
// READ-ONLY : ne persiste rien, aucun consommateur branché.
// ─────────────────────────────────────────────────────────────────────────────

export type CboReducedEntry = {
  cboId: string
  canonicalSubjectId: string | null
  label: string
  nature: ReturnType<typeof deriveCboNature>
  reduced: CboReducedState
  /**
   * P3-Actions-Lot1 — membre site_action VIVANT DÉTERMINISTE portant le geste humain de
   * clôture/réouverture (le geste est per-site_action, le CBO agrège). Règle : membre à la
   * date métier la PLUS RÉCENTE (tie → id). Émettre un event natif sur ce membre bascule LE
   * CBO (prouvé §2). null = aucun membre vivant (dangling) → clôture non proposable. */
  targetActionId: string | null
  /** Nombre de complétions documentaires EFFECTIVES (B HIGH) attribuées à ce CBO. */
  documentaryHighCount: number
  /** Complétions documentaires SUPPRIMÉES par la qualification C1C (non one_shot/terminal). */
  suppressedByNature: number
  /** Nombre de doc_open(T) émis (membres datables hors document de complétion). */
  docOpenCount: number
  /** Membres exclus du doc_open car provenant du document de complétion (règle de provenance). */
  membersSharedWithCompletionDoc: number
}

/**
 * État réduit de chaque CBO action d'un site, composé depuis les sources autoritatives.
 * Déterministe et READ-ONLY. La complétion documentaire n'est émise que si (a) une résolution B
 * effective MATCH/HIGH existe pour le CBO ET (b) la nature C1C du libellé est one_shot+terminal.
 */
export async function loadCboReducedStates(
  siteId: string,
  opts?: { canonicalSubjectId?: string },
): Promise<Map<string, CboReducedEntry>> {
  const sb = createAdminClient()
  const out = new Map<string, CboReducedEntry>()
  const CHUNK = 100

  // 1. CBO action du site (option : scopé à un sujet pour la fiche — évite une réduction site entière).
  let cboQuery = sb
    .from('canonical_business_object')
    .select('id, label, canonical_subject_id')
    .eq('site_id', siteId).eq('object_type', 'site_action')
  if (opts?.canonicalSubjectId) cboQuery = cboQuery.eq('canonical_subject_id', opts.canonicalSubjectId)
  const { data: cboRows } = await cboQuery
  const cbos = (cboRows ?? []) as Array<{ id: string; label: string; canonical_subject_id: string | null }>
  if (cbos.length === 0) return out
  const cboIds = cbos.map((c) => c.id)
  const subjByCbo = new Map(cbos.map((c) => [c.id, c.canonical_subject_id]))
  const cboIdSet = new Set(cboIds)

  // 2. Membership CBO → membres site_action (source d'INVENTAIRE : canonical_business_object_member).
  const memberIdsByCbo = new Map<string, string[]>()
  const allMemberIds = new Set<string>()
  for (let i = 0; i < cboIds.length; i += CHUNK) {
    const { data } = await sb
      .from('canonical_business_object_member')
      .select('canonical_business_object_id, member_entity_id, member_entity_type')
      .in('canonical_business_object_id', cboIds.slice(i, i + CHUNK))
      .eq('member_entity_type', 'site_action')
    for (const r of (data ?? []) as Array<{ canonical_business_object_id: string; member_entity_id: string }>) {
      const l = memberIdsByCbo.get(r.canonical_business_object_id) ?? []
      l.push(r.member_entity_id); memberIdsByCbo.set(r.canonical_business_object_id, l)
      allMemberIds.add(r.member_entity_id)
    }
  }

  // 3. Résolution des membres → site_action vivant → report → document (id + date métier).
  //    Un membre sans site_action = DANGLING → absent de cette map → ignoré (jamais inventé).
  const actionInfo = new Map<string, { reportId: string | null }>()
  const memberIdList = [...allMemberIds]
  for (let i = 0; i < memberIdList.length; i += CHUNK) {
    const { data } = await sb.from('site_actions').select('id, report_id').in('id', memberIdList.slice(i, i + CHUNK))
    for (const a of (data ?? []) as Array<{ id: string; report_id: string | null }>) actionInfo.set(a.id, { reportId: a.report_id })
  }
  const reportIds = [...new Set([...actionInfo.values()].map((a) => a.reportId).filter((x): x is string => !!x))]
  const reportDoc = new Map<string, string>()
  for (let i = 0; i < reportIds.length; i += CHUNK) {
    const { data } = await sb.from('site_reports').select('id, source_document_id').in('id', reportIds.slice(i, i + CHUNK))
    for (const r of (data ?? []) as Array<{ id: string; source_document_id: string | null }>) if (r.source_document_id) reportDoc.set(r.id, r.source_document_id)
  }
  const docDate = new Map<string, string>()
  const docIds = [...new Set([...reportDoc.values()])]
  for (let i = 0; i < docIds.length; i += CHUNK) {
    const { data } = await sb.from('documents').select('id, effective_date').in('id', docIds.slice(i, i + CHUNK))
    for (const d of (data ?? []) as Array<{ id: string; effective_date: string | null }>) if (d.effective_date) docDate.set(d.id, d.effective_date)
  }
  // date métier + document source d'un membre (undefined si dangling ou chaîne incomplète).
  const memberBusiness = (memberId: string): { docId: string; date: string } | null => {
    const a = actionInfo.get(memberId); if (!a?.reportId) return null
    const docId = reportDoc.get(a.reportId); if (!docId) return null
    const date = docDate.get(docId); if (!date) return null
    return { docId, date }
  }

  // 4. Journal natif des membres vivants (site_action_events) — created EXCLU en aval par nativeKindOf.
  const journalByAction = new Map<string, Array<{ kind: string; occurredAt: string }>>()
  const liveActionIds = [...actionInfo.keys()]
  for (let i = 0; i < liveActionIds.length; i += CHUNK) {
    const { data } = await sb.from('site_action_events').select('action_id, kind, occurred_at').in('action_id', liveActionIds.slice(i, i + CHUNK))
    for (const e of (data ?? []) as Array<{ action_id: string; kind: string; occurred_at: string }>) {
      const l = journalByAction.get(e.action_id) ?? []
      l.push({ kind: e.kind, occurredAt: e.occurred_at }); journalByAction.set(e.action_id, l)
    }
  }

  // 5. Complétions documentaires EFFECTIVES (B HIGH, policy active) : date + document de la preuve.
  //    Réutilise la chaîne autoritative loadProposalProofs → getEffectiveResolutionByProposal.
  const highByCbo = new Map<string, Array<{ date: string | null; proposalId: string; docId: string | null }>>()
  const allProofs = await loadProposalProofs(siteId)
  // Scopé sujet : ne garder que les preuves dont un candidat appartient aux CBO du sujet (fiche = léger).
  const proofs = opts?.canonicalSubjectId
    ? allProofs.filter((p) => p.candidates.some((c) => cboIdSet.has(c.cboId)))
    : allProofs
  const proofDocByProposal = new Map<string, string | null>()
  {
    const propIds = proofs.map((p) => p.proof.proposalId)
    for (let i = 0; i < propIds.length; i += CHUNK) {
      const { data } = await sb.from('document_extraction_proposal').select('id, document_id').in('id', propIds.slice(i, i + CHUNK))
      for (const p of (data ?? []) as Array<{ id: string; document_id: string | null }>) proofDocByProposal.set(p.id, p.document_id)
    }
  }
  for (const it of proofs) {
    const fp = computeProofContextFingerprint(it.proof, it.candidates)
    const eff = await getEffectiveResolutionByProposal(it.proof.proposalId, fp, ACTIVE_POLICY_VERSION)
    if (!eff || eff.decision !== 'MATCH' || eff.confidenceClass !== 'HIGH' || !eff.selectedCboId) continue
    const l = highByCbo.get(eff.selectedCboId) ?? []
    l.push({ date: it.proof.effectiveDate ?? null, proposalId: it.proof.proposalId, docId: proofDocByProposal.get(it.proof.proposalId) ?? null })
    highByCbo.set(eff.selectedCboId, l)
  }

  // 6. Réduction par CBO — assemblage PUR (assembleCboEvents) puis reduceCboLifecycle.
  for (const cbo of cbos) {
    const memberIds = memberIdsByCbo.get(cbo.id) ?? []
    const members: CboMemberProvenance[] = memberIds.map((memberId) => {
      const biz = memberBusiness(memberId)
      return { memberId, docId: biz?.docId ?? null, date: biz?.date ?? null }
    })
    const completions: CboCompletionProof[] = (highByCbo.get(cbo.id) ?? []).map((h) => ({ proposalId: h.proposalId, docId: h.docId, date: h.date }))
    const natives: CboNativeJournalEvent[] = memberIds.flatMap((memberId) => (journalByAction.get(memberId) ?? []).map((e) => ({ kind: e.kind, occurredAt: e.occurredAt })))

    const asm = assembleCboEvents(cbo.label, members, completions, natives)
    const reduced = reduceCboLifecycle(asm.events)
    // Target déterministe : membre VIVANT (présent dans actionInfo) à la date métier la plus
    // récente, tie → id. Seul un membre vivant peut porter le geste natif (close/reopen).
    const liveMembers = memberIds.filter((m) => actionInfo.has(m))
    const targetActionId = liveMembers.length === 0 ? null : [...liveMembers].sort((a, b) => {
      const da = memberBusiness(a)?.date ?? ''
      const db = memberBusiness(b)?.date ?? ''
      return db.localeCompare(da) || a.localeCompare(b)
    })[0]
    out.set(cbo.id, {
      cboId: cbo.id, canonicalSubjectId: subjByCbo.get(cbo.id) ?? null, label: cbo.label, nature: asm.nature, reduced,
      documentaryHighCount: asm.documentaryHighCount, suppressedByNature: asm.suppressedByNature,
      docOpenCount: asm.docOpenCount, membersSharedWithCompletionDoc: asm.membersSharedWithCompletionDoc,
      targetActionId,
    })
  }

  return out
}

/**
 * P1-4C2E2 — détail des CBO action réduits, groupés par canonical_subject. READ-ONLY.
 * Sert au contexte Copilote (vérité C2A par objet métier) ; l'IA l'explique, ne le recalcule pas.
 */
export async function loadCboReducedBySubject(
  siteId: string,
  opts?: { canonicalSubjectId?: string },
): Promise<Map<string, CboReducedEntry[]>> {
  const reduced = await loadCboReducedStates(siteId, opts)
  const bySubject = new Map<string, CboReducedEntry[]>()
  for (const e of reduced.values()) {
    if (!e.canonicalSubjectId) continue
    const l = bySubject.get(e.canonicalSubjectId) ?? []
    l.push(e); bySubject.set(e.canonicalSubjectId, l)
  }
  return bySubject
}

/**
 * Agrégat SUJET ← CBO (P1-4C2D) : `SubjectCboState` par canonical_subject, à partir des CBO action
 * réduits. Sert à remplacer la SEULE contribution action de `activeObjectsTotal` (P0-2). READ-ONLY.
 * `opts.canonicalSubjectId` scope à un sujet (fiche) ; sinon site entier (Suivi/Attention).
 */
export async function loadActiveActionCboBySubject(
  siteId: string,
  opts?: { canonicalSubjectId?: string },
): Promise<Map<string, SubjectCboState>> {
  const reduced = await loadCboReducedStates(siteId, opts)
  const bySubject = new Map<string, CboReducedState[]>()
  for (const e of reduced.values()) {
    if (!e.canonicalSubjectId) continue // CBO sans sujet (dangling) → hors agrégat sujet
    const l = bySubject.get(e.canonicalSubjectId) ?? []
    l.push(e.reduced); bySubject.set(e.canonicalSubjectId, l)
  }
  const out = new Map<string, SubjectCboState>()
  for (const [subjId, states] of bySubject) out.set(subjId, deriveCanonicalSubjectCboState(states))
  return out
}
