import 'server-only'

// Vie d'un sujet — read-model pour canonical_subject
//
// Agrège l'histoire métier d'un sujet à travers tous les PV du chantier,
// quelle que soit la formulation (N subject_thread_id → 1 canonical_subject).
//
// Lecture seule. Ne modifie aucune donnée.

import { createAdminClient } from '@/lib/supabase/admin'
import { canonicalRunsForSite, runEffectiveDate, computeHistoryTransition } from '@/lib/documents/pv-history'
import { documentStatusToPvState, visitStatusToPvState, computeLmcaFromOccurrences, collapseLmcaOccurrencesByDate, deriveCurrentResolvedState, deriveCanonicalCurrentState, type LmcaOccurrence, type PvState, type CanonicalDisplayState } from '@/lib/documents/subject-state'
import type { HistoryTransition } from '@/lib/documents/pv-history'
import type { SubjectLinkType, SubjectLinkStatus, SubjectLinkSource } from '@/lib/db/subject-thread-links'
import { isOperationalSubject } from '@/lib/subjects/kind'
import { isStagnationEligible, isOpenOperationalObjectStatus } from '@/lib/subjects/stagnation'
import { computeNativeChangeMetrics } from '@/lib/knowledge/evolution-metrics'
import { loadActiveActionCboBySubject } from '@/lib/knowledge/canonical-business-object-evolution'
import { activeObjectsTotalForState, type SubjectCboState } from '@/lib/knowledge/cbo-lifecycle-reducer'
import { isImportedDocumentOrigin } from '@/lib/field/visit-origins'

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
  /** R-1 : date propre du fait (event_date), distincte de effectiveDate (date du PV). Null si absente.
   *  Position longitudinale = eventDate ?? effectiveDate ; lastSeen reste fondé sur effectiveDate. */
  eventDate: string | null
  /** Identifiant de la proposition principale (null pour les gaps). */
  proposalId: string | null
  threadId: string | null
  label: string | null
  description: string | null
  documentStatus: string | null
  /** R-1 : tri-state longitudinal de l'occurrence historique (resolved|open|unknown). Null pour les
   *  gaps et les occurrences terrain (qui portent visitStatus). Remplace la dérivation document_status. */
  stateStatus: PvState | null
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
  /** Label avec alias substitué par canonical_label si entity_ids résolus ; null = afficher label brut. */
  resolvedLabel: string | null
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
  source: SubjectLinkSource
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

export interface TerrainObject {
  entityType: 'site_action' | 'site_deadline'
  entityId: string
  title: string
  description: string | null
  status: string | null
  createdAt: string
  /** Vrai si l'objet a été matérialisé depuis un PV importé (report origin='import').
   *  Un tel objet est déjà porté par l'occurrence documentaire (mécanisme A) : il ne
   *  constitue PAS un événement LMCA de Niveau 2 (sa `created_at` = jour d'import, pas
   *  la date du PV). Exclu de l'avancement LMCA, mais conservé pour l'affichage. (9+10B) */
  fromImport: boolean
}

/** Projection minimale d'un sujet prouvé ouvert — pour les contextes Copilote. */
export interface SubjectOpenSummary {
  canonicalSubjectId: string
  title: string
  activeObjectsTotal: number
}

export interface MergeRecord {
  loserLabel: string
  mergedAt: string
  resolutionSource: 'llm' | 'manual'
  suggestedLabel: string | null
}

export interface CanonicalSubjectLife {
  canonicalSubjectId: string
  siteId: string
  label: string
  aliases: string[]
  csStatus: string
  mergedInto: string | null          // non-null si status='merged'
  mergedIntoLabel: string | null     // label du winner si status='merged'
  mergesAsWinner: MergeRecord[]      // fusions dont ce sujet est le winner
  firstSeenAt: string | null
  lastSeenAt: string | null
  currentStatus: string | null
  /** P0-2 — Projection opérationnelle COURANTE unique (open|resolved|reopened|unknown). Vérité du badge. */
  displayState: CanonicalDisplayState
  /** P0-2 — open OU objet actif rattaché (isProvenOpen). */
  provenOpen: boolean
  primaryFamily: string | null
  threadIds: string[]
  pvCount: number
  fieldVisitCount: number
  /** Tous les runs canoniques du chantier (axe temporel complet). */
  runs: Array<{ id: string; documentId: string; effectiveDate: string }>
  occurrences: SubjectOccurrenceMerged[]
  links: CanonicalLink[]
  materializedEvents: MaterializedEvent[]
  terrainObjects: TerrainObject[]
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

// ── Entity resolution ─────────────────────────────────────────────────────────

type EntityResolutionMap = Map<string, { canonicalLabel: string; aliases: string[] }>

async function buildEntityResolutionMap(
  supabase: ReturnType<typeof createAdminClient>,
  entityIds: string[],
): Promise<EntityResolutionMap> {
  if (entityIds.length === 0) return new Map()
  const { data } = await supabase
    .from('site_knowledge_entities')
    .select('id, canonical_label, site_knowledge_entity_aliases(alias)')
    .in('id', entityIds)
  const map: EntityResolutionMap = new Map()
  for (const row of (data ?? []) as Array<{
    id: string
    canonical_label: string
    site_knowledge_entity_aliases: Array<{ alias: string }>
  }>) {
    map.set(row.id, {
      canonicalLabel: row.canonical_label,
      aliases: (row.site_knowledge_entity_aliases ?? []).map((a) => a.alias),
    })
  }
  return map
}

// Substitue les alias d'entités connues par leur canonical_label dans le label d'occurrence.
// Ne modifie rien si entity_ids est vide (pas de résolution heuristique).
// Retourne null si aucune substitution n'a eu lieu (afficher le label brut).
function applyEntitySubstitution(
  label: string | null,
  entityIds: string[] | null,
  entityMap: EntityResolutionMap,
): string | null {
  if (!label || !entityIds?.length) return null
  let result = label
  let changed = false
  for (const entityId of entityIds) {
    const entity = entityMap.get(entityId)
    if (!entity) continue
    const sorted = [...entity.aliases].sort((a, b) => b.length - a.length)
    for (const alias of sorted) {
      if (!alias) continue
      const lowerResult = result.toLowerCase()
      const lowerAlias = alias.toLowerCase()
      const idx = lowerResult.indexOf(lowerAlias)
      if (idx === -1) continue
      const before = idx > 0 ? result[idx - 1] : ' '
      const after = idx + alias.length < result.length ? result[idx + alias.length] : ' '
      if (!/[a-zA-ZÀ-ÿ0-9]/.test(before) && !/[a-zA-ZÀ-ÿ0-9]/.test(after)) {
        result = result.slice(0, idx) + entity.canonicalLabel + result.slice(idx + alias.length)
        changed = true
        break
      }
    }
  }
  return changed ? result : null
}

// ── Helpers terrain (P1-4 Level 2 — objets liés par canonical_subject_id) ────

async function fetchTerrainObjectsByCs(
  supabase: ReturnType<typeof createAdminClient>,
  canonicalSubjectId: string,
): Promise<TerrainObject[]> {
  const [actRes, dlRes] = await Promise.all([
    supabase.from('site_actions').select('id, title, body, status, created_at, report_id').eq('canonical_subject_id', canonicalSubjectId),
    supabase.from('site_deadlines').select('id, title, constraint_text, status, created_at, report_id').eq('canonical_subject_id', canonicalSubjectId),
  ])
  type AR = { id: string; title: string; body: string | null; status: string; created_at: string; report_id: string | null }
  type DL = { id: string; title: string; constraint_text: string | null; status: string | null; created_at: string; report_id: string | null }
  const acts = (actRes.data ?? []) as AR[]
  const dls = (dlRes.data ?? []) as DL[]
  // Origine des reports source → `fromImport` (9+10B) : un objet issu d'un PV importé
  // n'est pas un événement LMCA de Niveau 2 (déjà porté par l'occurrence).
  const originByReport = await resolveReportOrigins(supabase, [...acts.map((a) => a.report_id), ...dls.map((d) => d.report_id)])
  const isImport = (reportId: string | null) => reportId != null && isImportedDocumentOrigin(originByReport.get(reportId) ?? null)
  const objects: TerrainObject[] = []
  for (const r of acts) {
    const caDate = r.created_at?.substring(0, 10)
    if (caDate) objects.push({ entityType: 'site_action', entityId: r.id, title: r.title, description: r.body, status: r.status, createdAt: caDate, fromImport: isImport(r.report_id) })
  }
  for (const r of dls) {
    const caDate = r.created_at?.substring(0, 10)
    if (caDate) objects.push({ entityType: 'site_deadline', entityId: r.id, title: r.title, description: r.constraint_text, status: r.status, createdAt: caDate, fromImport: isImport(r.report_id) })
  }
  return objects
}

/**
 * Niveau 2 terrain — PRIMITIVE UNIQUE (fiche Sujet + liste Suivi), 9+10B.
 * Un objet opérationnel (`site_action`/`site_deadline`) fait avancer LMCA seulement
 * s'il représente un événement RÉELLEMENT nouveau, hors chronologie documentaire.
 * Les objets **matérialisés depuis un PV importé** (`fromImport`) sont EXCLUS : leur
 * temporalité est déjà portée par l'occurrence (mécanisme A, `effectiveDate` du PV) ;
 * leur `created_at` = jour d'import ferait un second événement LMCA fictif. On ne
 * remplace pas non plus `created_at` par la date du PV : ce serait un doublon du
 * mécanisme A. La sémantique « mention/insert ≠ changement » est préservée.
 */
export function applyTerrainLevel2(
  terrainObjects: TerrainObject[],
  firstSeenAt: string | null,
  lastMeaningfulChangeAt: string | null,
  consecutiveMentionsWithoutChange: number,
): { lastMeaningfulChangeAt: string | null; consecutiveMentionsWithoutChange: number } {
  if (!firstSeenAt) return { lastMeaningfulChangeAt, consecutiveMentionsWithoutChange }
  const dates = terrainObjects
    .filter((o) => !o.fromImport)
    .map((o) => o.createdAt)
    .filter((d) => d > firstSeenAt)
  if (dates.length === 0) return { lastMeaningfulChangeAt, consecutiveMentionsWithoutChange }
  const objectLmca = [...dates].sort().pop()!
  if (!lastMeaningfulChangeAt || objectLmca > lastMeaningfulChangeAt) {
    return { lastMeaningfulChangeAt: objectLmca, consecutiveMentionsWithoutChange: 0 }
  }
  return { lastMeaningfulChangeAt, consecutiveMentionsWithoutChange }
}

/** Résout `origin` d'un lot de report_id → Map (fail-safe : report absent = origin null). */
async function resolveReportOrigins(
  supabase: ReturnType<typeof createAdminClient>,
  reportIds: Array<string | null>,
): Promise<Map<string, string | null>> {
  const ids = [...new Set(reportIds.filter((r): r is string => !!r))]
  const map = new Map<string, string | null>()
  if (ids.length === 0) return map
  const { data } = await supabase.from('site_reports').select('id, origin').in('id', ids)
  for (const r of (data ?? []) as Array<{ id: string; origin: string | null }>) map.set(r.id, r.origin)
  return map
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
    .select('id, site_id, label, aliases, status, merged_into, kind')
    .eq('id', canonicalSubjectId)
    .maybeSingle()
  if (!cs) return null

  const siteId: string = (cs as { site_id: string }).site_id
  const csLabel: string = (cs as { label: string }).label
  const csAliases: string[] = (cs as { aliases: string[] }).aliases ?? []
  const csStatus: string = (cs as { status: string }).status
  const csMergedInto: string | null = (cs as { merged_into: string | null }).merged_into ?? null
  // #228 : nature durable (actor|business_subject) — base de l'éligibilité opérationnelle ET stagnation.
  const csKind: string | null = (cs as { kind: string | null }).kind ?? null

  // P1-4C2D — agrégat CBO du sujet (scopé) : remplace la SEULE composante action de activeObjectsTotal.
  // Best-effort : si la couche CBO échoue, on retombe sur la vérité brute (subjectCbo = undefined).
  let subjectCbo: SubjectCboState | undefined
  try {
    subjectCbo = (await loadActiveActionCboBySubject(siteId, { canonicalSubjectId })).get(canonicalSubjectId)
  } catch { subjectCbo = undefined }

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
      .select('id, source_ref_id, source_proposal_id, source_kind, visit_status, label, note, evidence_count, effective_date, entity_ids')
      .eq('canonical_subject_id', canonicalSubjectId)
      .in('source_kind', ['field_visit', 'meeting'])
      .not('validation_status', 'in', '("rejected","source_superseded")')
      .order('effective_date', { ascending: true })
    type NativeCsoRow = {
      id: string; source_ref_id: string; source_proposal_id: string | null
      source_kind: 'field_visit' | 'meeting'; visit_status: string | null
      label: string; note: string | null; evidence_count: number; effective_date: string
      entity_ids: string[] | null
    }
    const nativeRows = (nativeCsoRows ?? []) as NativeCsoRow[]
    const nativeEntityIds = [...new Set(nativeRows.flatMap((r) => r.entity_ids ?? []))]
    const nativeEntityMap = await buildEntityResolutionMap(supabase, nativeEntityIds)
    const nativeOccs: SubjectOccurrenceMerged[] = nativeRows.map((row) => ({
      sourceKind: row.source_kind,
      runId: null, documentId: null, reportId: row.source_ref_id,
      effectiveDate: row.effective_date, eventDate: null, proposalId: row.source_proposal_id,
      threadId: null, label: row.label, description: row.note,
      documentStatus: null, stateStatus: null, visitStatus: row.visit_status,
      proposalFamily: null, thematicCategory: null, sourcePage: null,
      transition: null, isGap: false, evidenceCount: row.evidence_count, additionalLabels: [],
      resolvedLabel: applyEntitySubstitution(row.label, row.entity_ids, nativeEntityMap),
    }))
    const nativeReal = nativeOccs.filter((o) => !o.isGap)
    const nativeFirstSeenAt = nativeReal[0]?.effectiveDate ?? null
    const nativeLastSeenAt = nativeReal[nativeReal.length - 1]?.effectiveDate ?? null
    const nativeMetrics = computeNativeChangeMetrics(nativeReal, nativeLastSeenAt)
    const terrainObjects = await fetchTerrainObjectsByCs(supabase, canonicalSubjectId)
    const { lastMeaningfulChangeAt: nativeLmca, consecutiveMentionsWithoutChange: nativeCwc } =
      applyTerrainLevel2(terrainObjects, nativeFirstSeenAt, nativeMetrics.lastMeaningfulChangeAt, nativeMetrics.consecutiveMentionsWithoutChange)
    const nativeStagDays = (nativeLmca && nativeLastSeenAt && nativeLmca !== nativeLastSeenAt)
      ? Math.floor((new Date(nativeLastSeenAt).getTime() - new Date(nativeLmca).getTime()) / 86_400_000)
      : 0
    const nativeCurrent = deriveCanonicalCurrentState({
      occurrences: nativeReal.map((o) => ({ effectiveDate: o.effectiveDate, pvState: o.stateStatus ?? (o.visitStatus !== null ? visitStatusToPvState(o.visitStatus) : documentStatusToPvState(o.documentStatus)) })),
      activeObjectsTotal: activeObjectsTotalForState(
        subjectCbo,
        terrainObjects.some((t) => t.entityType === 'site_action' && isOpenOperationalObjectStatus(t.entityType, t.status)),
        terrainObjects.some((t) => t.entityType !== 'site_action' && isOpenOperationalObjectStatus(t.entityType, t.status)),
      ),
    })
    return {
      canonicalSubjectId, siteId, label: csLabel, aliases: csAliases, csStatus,
      mergedInto: csMergedInto, mergedIntoLabel: null, mergesAsWinner: [],
      firstSeenAt: nativeFirstSeenAt,
      lastSeenAt: nativeLastSeenAt,
      currentStatus: nativeReal[nativeReal.length - 1]?.visitStatus ?? null,
      displayState: nativeCurrent.displayState, provenOpen: nativeCurrent.provenOpen,
      primaryFamily: null, threadIds: [],
      pvCount: 0,
      fieldVisitCount: new Set(nativeReal.filter((o) => o.sourceKind === 'field_visit' || o.sourceKind === 'meeting').map((o) => `${o.sourceKind}-${o.effectiveDate}`)).size,
      runs: [], occurrences: nativeOccs, links: [], materializedEvents: [], terrainObjects,
      lastMeaningfulChangeAt: nativeLmca,
      stagnationDays: nativeStagDays,
      consecutiveMentionsWithoutChange: nativeCwc,
      // #228 Lot B — attente d'évolution prouvée : objet terrain ouvert (aucune trajectoire PV → pas de reopened).
      isStagnant: isStagnationEligible(csKind, terrainObjects.some((t) => isOpenOperationalObjectStatus(t.entityType, t.status)), false)
        && nativeStagDays >= 30 && nativeCwc >= 2,
    }
  }

  // 3. Runs canoniques du chantier (axe temporel)
  const allRuns = await canonicalRunsForSite(siteId)
  const canonicalRunIds = allRuns.map((r) => r.id)

  if (canonicalRunIds.length === 0) {
    // Sujet avec thread(s) mais sans PV PDF (ex : visites terrain uniquement).
    // La doc V1 notait "à corriger en V2" — on lit quand même les occurrences terrain.
    type CsoRowShort = {
      id: string; source_ref_id: string; source_proposal_id: string | null
      source_kind: 'field_visit' | 'meeting'; visit_status: string | null
      label: string; note: string | null; evidence_count: number; effective_date: string
      entity_ids: string[] | null
    }
    const { data: csoFallback } = await supabase
      .from('canonical_subject_occurrence')
      .select('id, source_ref_id, source_proposal_id, source_kind, visit_status, label, note, evidence_count, effective_date, entity_ids')
      .eq('canonical_subject_id', canonicalSubjectId)
      .in('source_kind', ['field_visit', 'meeting'])
      .not('validation_status', 'in', '("rejected","source_superseded")')
      .order('effective_date', { ascending: true })
    const fallbackRows = (csoFallback ?? []) as CsoRowShort[]
    const fallbackEntityIds = [...new Set(fallbackRows.flatMap((r) => r.entity_ids ?? []))]
    const fallbackEntityMap = await buildEntityResolutionMap(supabase, fallbackEntityIds)
    const fallbackOccs: SubjectOccurrenceMerged[] = fallbackRows.map((row) => ({
      sourceKind: row.source_kind, runId: null, documentId: null, reportId: row.source_ref_id,
      effectiveDate: row.effective_date, eventDate: null, proposalId: row.source_proposal_id, threadId: null,
      label: row.label, description: row.note, documentStatus: null, stateStatus: null, visitStatus: row.visit_status,
      proposalFamily: null, thematicCategory: null, sourcePage: null, transition: null,
      isGap: false, evidenceCount: row.evidence_count, additionalLabels: [],
      resolvedLabel: applyEntitySubstitution(row.label, row.entity_ids, fallbackEntityMap),
    }))
    const fallbackReal = fallbackOccs.filter((o) => !o.isGap)
    const fallbackFirst = fallbackReal[0]?.effectiveDate ?? null
    const fallbackLast = fallbackReal[fallbackReal.length - 1]?.effectiveDate ?? null
    const fallbackMetrics = computeNativeChangeMetrics(fallbackReal, fallbackLast)
    const terrainObjects = await fetchTerrainObjectsByCs(supabase, canonicalSubjectId)
    const { lastMeaningfulChangeAt: fallbackLmca, consecutiveMentionsWithoutChange: fallbackCwc } =
      applyTerrainLevel2(terrainObjects, fallbackFirst, fallbackMetrics.lastMeaningfulChangeAt, fallbackMetrics.consecutiveMentionsWithoutChange)
    const fallbackStagDays = (fallbackLmca && fallbackLast && fallbackLmca !== fallbackLast)
      ? Math.floor((new Date(fallbackLast).getTime() - new Date(fallbackLmca).getTime()) / 86_400_000)
      : 0
    const fallbackCurrent = deriveCanonicalCurrentState({
      occurrences: fallbackReal.map((o) => ({ effectiveDate: o.effectiveDate, pvState: o.stateStatus ?? (o.visitStatus !== null ? visitStatusToPvState(o.visitStatus) : documentStatusToPvState(o.documentStatus)) })),
      activeObjectsTotal: activeObjectsTotalForState(
        subjectCbo,
        terrainObjects.some((t) => t.entityType === 'site_action' && isOpenOperationalObjectStatus(t.entityType, t.status)),
        terrainObjects.some((t) => t.entityType !== 'site_action' && isOpenOperationalObjectStatus(t.entityType, t.status)),
      ),
    })
    return {
      canonicalSubjectId, siteId, label: csLabel, aliases: csAliases, csStatus,
      mergedInto: csMergedInto, mergedIntoLabel: null, mergesAsWinner: [],
      firstSeenAt: fallbackFirst, lastSeenAt: fallbackLast,
      currentStatus: fallbackReal[fallbackReal.length - 1]?.visitStatus ?? null,
      displayState: fallbackCurrent.displayState, provenOpen: fallbackCurrent.provenOpen,
      primaryFamily: null, threadIds, pvCount: 0,
      fieldVisitCount: new Set(fallbackReal.map((o) => `${o.sourceKind}-${o.effectiveDate}`)).size,
      runs: [], occurrences: fallbackOccs, links: [], materializedEvents: [], terrainObjects,
      lastMeaningfulChangeAt: fallbackLmca,
      stagnationDays: fallbackStagDays,
      consecutiveMentionsWithoutChange: fallbackCwc,
      // #228 Lot B — attente d'évolution prouvée : objet terrain ouvert (aucune trajectoire PV → pas de reopened).
      isStagnant: isStagnationEligible(csKind, terrainObjects.some((t) => isOpenOperationalObjectStatus(t.entityType, t.status)), false)
        && fallbackStagDays >= 30 && fallbackCwc >= 2,
    }
  }

  // 4. R-1 : la timeline historique se lit depuis canonical_subject_occurrence (source de vérité),
  //    plus depuis les propositions. Les propositions restent l'artefact d'extraction/preuve et servent
  //    uniquement à reconstruire le lien matérialisations (relation existante, section 6).
  const { data: histOccRaw } = await supabase
    .from('canonical_subject_occurrence')
    .select('id, source_ref_id, state_key, state_status, label, note, evidence_count, effective_date, event_date, source_page, thematic_category, entity_ids')
    .eq('canonical_subject_id', canonicalSubjectId)
    .eq('source_kind', 'historical_pdf')
    .not('validation_status', 'in', '("rejected","source_superseded")')
  type HistOccRow = {
    id: string; source_ref_id: string; state_key: string; state_status: PvState | null
    label: string; note: string | null; evidence_count: number; effective_date: string
    event_date: string | null; source_page: number | null; thematic_category: string | null
    entity_ids: string[] | null
  }
  const histOcc = (histOccRaw ?? []) as HistOccRow[]

  // report (source_ref_id) → run : replace les occurrences sur l'axe documentaire (gaps, provenance PV).
  const histReportIds = [...new Set(histOcc.map((o) => o.source_ref_id))]
  const reportToRun = new Map<string, string>()
  if (histReportIds.length > 0) {
    const { data: repRows } = await supabase
      .from('site_reports').select('id, extraction_run_id').in('id', histReportIds)
    for (const r of (repRows ?? []) as Array<{ id: string; extraction_run_id: string | null }>) {
      if (r.extraction_run_id) reportToRun.set(r.id, r.extraction_run_id)
    }
  }

  // Propositions COMPLÈTES — lien matérialisations (section 6) ET timeline de REPLI pour les sujets
  // SANS occurrence historique (acteurs person/company, ou sujets dont toutes les propositions sont
  // inéligibles). Ces sujets ne sont pas des sujets d'occurrence → comportement historique préservé.
  const { data: propsRaw } = await supabase
    .from('document_extraction_proposal')
    .select('id, extraction_run_id, subject_thread_id, proposal_family, thematic_category, label, description, document_status, source_page')
    .in('subject_thread_id', threadIds)
    .in('extraction_run_id', canonicalRunIds)
  const props = (propsRaw ?? []) as ProposalRow[]
  const proposalToRun = new Map<string, string>(props.map((p) => [p.id, p.extraction_run_id]))
  const proposalIds = props.map((p) => p.id)

  // Résolution d'alias (entity_ids) — parité avec l'ancien chemin terrain.
  const histEntityIds = [...new Set(histOcc.flatMap((o) => o.entity_ids ?? []))]
  const histEntityMap = await buildEntityResolutionMap(supabase, histEntityIds)

  const occurrenceBacked = histOcc.length > 0

  // Index par run (occurrences ET propositions).
  const occByRun = new Map<string, HistOccRow[]>()
  for (const o of histOcc) {
    const runId = reportToRun.get(o.source_ref_id)
    if (!runId) continue
    if (!occByRun.has(runId)) occByRun.set(runId, [])
    occByRun.get(runId)!.push(o)
  }
  const propsByRun = new Map<string, ProposalRow[]>()
  for (const p of props) {
    const list = propsByRun.get(p.extraction_run_id) ?? []
    list.push(p); propsByRun.set(p.extraction_run_id, list)
  }

  const firstRunIndex = allRuns.findIndex((r) => (occurrenceBacked ? occByRun.has(r.id) : propsByRun.has(r.id)))
  if (firstRunIndex < 0) {
    return {
      canonicalSubjectId, siteId, label: csLabel, aliases: csAliases, csStatus,
      mergedInto: csMergedInto, mergedIntoLabel: null, mergesAsWinner: [],
      firstSeenAt: null, lastSeenAt: null, currentStatus: null,
      displayState: 'unknown', provenOpen: false, primaryFamily: null,
      threadIds, pvCount: 0, fieldVisitCount: 0,
      runs: allRuns.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) })),
      occurrences: [], links: [], materializedEvents: [], terrainObjects: [],
      lastMeaningfulChangeAt: null, stagnationDays: null, consecutiveMentionsWithoutChange: 0, isStagnant: false,
    }
  }

  // Ordre longitudinal intra-PV : position (event_date ?? effective_date), puis famille, puis label.
  const FAMILY_ORDER = ['reservation', 'action', 'decision', 'deadline', 'observation', 'knowledge_fact', 'person', 'company']
  const famRank = (f: string) => { const i = FAMILY_ORDER.indexOf(f); return i < 0 ? FAMILY_ORDER.length : i }
  // Tri-state → pseudo-statut brut pour réutiliser computeHistoryTransition sans la modifier.
  // Divergence attendue : le tri-state ne distingue pas cancelled/non_compliant/planned → pas de
  // transition annulé/aggravé/progressé (le modèle occurrence porte le tri-state, pas le statut brut).
  const stateToPseudoStatus = (s: PvState | null): string | null => s === 'resolved' ? 'done' : s === 'open' ? 'open' : null

  const relevantRuns = allRuns.slice(firstRunIndex)
  const occurrences: SubjectOccurrenceMerged[] = []
  let gapSinceLastOccurrence = false
  let prevResolvedState: boolean | null = null

  if (occurrenceBacked) {
    // ── Timeline depuis les occurrences : multiplicité conservée (N états/PV), gaps dérivés de l'axe.
    //    Gap 'non mentionné' UNIQUEMENT si le sujet est absent du PV (ni occurrence ni proposition).
    //    Présent sans état éligible (proposition présente, occurrence absente) → aucun état à montrer,
    //    on n'insère pas de faux gap (le PV compte quand même pour lastSeen via l'axe documentaire).
    for (const run of relevantRuns) {
      const runOccs = occByRun.get(run.id)
      const effectiveDate = runEffectiveDate(run)

      if (!runOccs || runOccs.length === 0) {
        if (propsByRun.has(run.id)) continue  // présent mais aucun état éligible → pas de gap
        occurrences.push({
          sourceKind: 'historical_pdf', runId: run.id, documentId: run.document_id, reportId: null,
          effectiveDate, eventDate: null, proposalId: null, threadId: null, label: null, description: null,
          documentStatus: null, stateStatus: null, visitStatus: null, proposalFamily: null,
          thematicCategory: null, sourcePage: null, transition: 'non_mentionné', isGap: true,
          evidenceCount: 0, additionalLabels: [], resolvedLabel: null,
        })
        gapSinceLastOccurrence = true
        continue
      }

      const sorted = [...runOccs].sort((a, b) => {
        const pa = a.event_date ?? a.effective_date, pb = b.event_date ?? b.effective_date
        if (pa !== pb) return pa.localeCompare(pb)
        const fr = famRank(a.state_key) - famRank(b.state_key)
        if (fr !== 0) return fr
        return (a.label ?? '').localeCompare(b.label ?? '')
      })
      const primaryIdx = sorted.reduce((best, o, i) => (famRank(o.state_key) < famRank(sorted[best].state_key) ? i : best), 0)
      const primary = sorted[primaryIdx]
      const runResolved = deriveCurrentResolvedState(sorted.map((o) => o.state_status ?? 'unknown'))
      const isFirst = occurrences.filter((o) => !o.isGap).length === 0
      const runTransition: HistoryTransition | null = isFirst
        ? null
        : computeHistoryTransition(primary.state_key, prevResolvedState, null, stateToPseudoStatus(primary.state_status), gapSinceLastOccurrence)

      sorted.forEach((o, i) => {
        occurrences.push({
          sourceKind: 'historical_pdf', runId: run.id, documentId: run.document_id, reportId: null,
          effectiveDate, eventDate: o.event_date, proposalId: null, threadId: null,
          label: o.label, description: o.note, documentStatus: null, stateStatus: o.state_status,
          visitStatus: null, proposalFamily: o.state_key, thematicCategory: o.thematic_category,
          sourcePage: o.source_page, transition: i === primaryIdx ? runTransition : null, isGap: false,
          evidenceCount: o.evidence_count, additionalLabels: [],
          resolvedLabel: applyEntitySubstitution(o.label, o.entity_ids, histEntityMap),
        })
      })
      if (runResolved === true) prevResolvedState = true
      else if (runResolved === false) prevResolvedState = false
      gapSinceLastOccurrence = false
    }
  } else {
    // ── Repli propositions : sujets SANS occurrence (acteurs). Comportement historique inchangé.
    const evidenceByProposal = new Map<string, number>()
    if (proposalIds.length > 0) {
      const { data: evidRows } = await supabase
        .from('document_proposal_evidence').select('proposal_id').in('proposal_id', proposalIds)
      for (const ev of (evidRows ?? []) as Array<{ proposal_id: string }>) {
        evidenceByProposal.set(ev.proposal_id, (evidenceByProposal.get(ev.proposal_id) ?? 0) + 1)
      }
    }
    let prevProp: ProposalRow | null = null
    for (const run of relevantRuns) {
      const runProps = propsByRun.get(run.id) ?? []
      const effectiveDate = runEffectiveDate(run)
      if (runProps.length === 0) {
        occurrences.push({
          sourceKind: 'historical_pdf', runId: run.id, documentId: run.document_id, reportId: null,
          effectiveDate, eventDate: null, proposalId: null, threadId: null, label: null, description: null,
          documentStatus: null, stateStatus: null, visitStatus: null, proposalFamily: null,
          thematicCategory: null, sourcePage: null, transition: 'non_mentionné', isGap: true,
          evidenceCount: 0, additionalLabels: [], resolvedLabel: null,
        })
        gapSinceLastOccurrence = true
        continue
      }
      const sorted = [...runProps].sort((a, b) => famRank(a.proposal_family) - famRank(b.proposal_family))
      const primary = sorted[0]
      const secondaries = sorted.slice(1)
      const isFirst = occurrences.filter((o) => !o.isGap).length === 0
      const transition: HistoryTransition | null = isFirst
        ? null
        : computeHistoryTransition(primary.proposal_family, prevResolvedState, prevProp?.document_status ?? null, primary.document_status, gapSinceLastOccurrence)
      occurrences.push({
        sourceKind: 'historical_pdf', runId: run.id, documentId: run.document_id, reportId: null,
        effectiveDate, eventDate: null, proposalId: primary.id, threadId: primary.subject_thread_id,
        label: primary.label, description: primary.description ?? null, documentStatus: primary.document_status ?? null,
        stateStatus: null, visitStatus: null, proposalFamily: primary.proposal_family,
        thematicCategory: primary.thematic_category ?? null, sourcePage: primary.source_page ?? null,
        transition, isGap: false, evidenceCount: evidenceByProposal.get(primary.id) ?? 0,
        additionalLabels: secondaries.map((p) => p.label), resolvedLabel: null,
      })
      prevProp = primary
      const pvState = documentStatusToPvState(primary.document_status ?? null)
      if (pvState === 'resolved') prevResolvedState = true
      else if (pvState === 'open') prevResolvedState = false
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
    .select('id, source_ref_id, source_proposal_id, source_kind, visit_status, label, note, evidence_count, effective_date, entity_ids')
    .eq('canonical_subject_id', canonicalSubjectId)
    .in('source_kind', ['field_visit', 'meeting'])
    .not('validation_status', 'in', '("rejected","source_superseded")')
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
    entity_ids: string[] | null
  }
  const csoRowsTyped = (csoRows ?? []) as CsoRow[]
  const csoEntityIds = [...new Set(csoRowsTyped.flatMap((r) => r.entity_ids ?? []))]
  const csoEntityMap = await buildEntityResolutionMap(supabase, csoEntityIds)
  for (const row of csoRowsTyped) {
    occurrences.push({
      sourceKind: row.source_kind,
      runId: null,
      documentId: null,
      reportId: row.source_ref_id,
      effectiveDate: row.effective_date,
      eventDate: null,
      proposalId: row.source_proposal_id,
      threadId: null,
      label: row.label,
      description: row.note,
      documentStatus: null,
      stateStatus: null,
      visitStatus: row.visit_status,
      proposalFamily: null,
      thematicCategory: null,
      sourcePage: null,
      transition: null,
      isGap: false,
      evidenceCount: row.evidence_count,
      additionalLabels: [],
      resolvedLabel: applyEntitySubstitution(row.label, row.entity_ids, csoEntityMap),
    })
  }

  // R-1 : ordre longitudinal = position (event_date ?? effective_date). Un fait 2024 rappelé dans un PV
  // 2025 se place en 2024 dans l'ordre. lastSeenAt/firstSeenAt restent fondés sur effective_date (date
  // documentaire) — le même rappel compte donc pour lastSeen 2025.
  const positionOf = (o: SubjectOccurrenceMerged) => o.eventDate ?? o.effectiveDate
  occurrences.sort((a, b) => {
    const pa = positionOf(a), pb = positionOf(b)
    if (pa !== pb) return pa.localeCompare(pb)
    return a.effectiveDate.localeCompare(b.effectiveDate)
  })

  const realOccurrences = occurrences.filter((o) => !o.isGap)

  // Stats de PRÉSENCE — firstSeen/lastSeen/pvCount se lisent sur l'AXE DOCUMENTAIRE (runs où le sujet
  // apparaît, occurrence OU proposition), pas sur les seuls états éligibles : un sujet présent dans un
  // PV sans y produire d'état atomique compte quand même pour lastSeen. + occurrences terrain.
  const runById = new Map(allRuns.map((r) => [r.id, r]))
  const historicalPresenceRunIds = new Set<string>([...occByRun.keys(), ...propsByRun.keys()])
  const historicalPresenceDates = [...historicalPresenceRunIds]
    .map((rid) => runById.get(rid)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => runEffectiveDate(r))
  const fieldDates = realOccurrences
    .filter((o) => o.sourceKind === 'field_visit' || o.sourceKind === 'meeting').map((o) => o.effectiveDate)
  const presenceDates = [...historicalPresenceDates, ...fieldDates]
  const firstSeenAt = presenceDates.length ? presenceDates.reduce((a, b) => (a < b ? a : b)) : null
  const lastSeenAt = presenceDates.length ? presenceDates.reduce((a, b) => (a > b ? a : b)) : null
  const pvCountHistorical = historicalPresenceRunIds.size

  // P0-2 — Occurrences projetées en tri-state (stateStatus ?? visitStatus↦ ?? documentStatus↦).
  // L'état COURANT partagé (displayState) est calculé plus bas via deriveCanonicalCurrentState, une
  // fois connu hasOpenOperationalObject. Effondrement open-dominant intra-date → plus de dépendance
  // à l'ordre SQL (élimine le non-déterminisme intra-date de l'ancien deriveCurrentResolvedState brut).
  const displayOccs = realOccurrences.map((o) => ({
    effectiveDate: o.effectiveDate,
    pvState: o.stateStatus ?? (o.visitStatus !== null ? visitStatusToPvState(o.visitStatus) : documentStatusToPvState(o.documentStatus)),
  }))
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

  // LMCA P1-4A — moteur tri-state unifié (remplace signature brute V1B)
  const lmcaOccsA: LmcaOccurrence[] = realOccurrences.map((occ) => ({
    effectiveDate: occ.eventDate ?? occ.effectiveDate,  // R-1 : LMCA raisonne sur la position temporelle
    pvState: occ.stateStatus
      ?? (occ.visitStatus !== null ? visitStatusToPvState(occ.visitStatus) : documentStatusToPvState(occ.documentStatus)),
    objectSig: occ.runId ? (matSigByRun.get(occ.runId) ?? '') : '',
  }))
  const terrainObjects = await fetchTerrainObjectsByCs(supabase, canonicalSubjectId)
  // P3-D1 : effondrer par date avant LMCA — la multiplicité atomique (N états/document) ne doit pas
  // fabriquer de changement intra-document ni dépendre de l'ordre des ex-æquo. NO-OP mono-occurrence.
  const lmcaBase = computeLmcaFromOccurrences(collapseLmcaOccurrencesByDate(lmcaOccsA))
  const { lastMeaningfulChangeAt, consecutiveMentionsWithoutChange } = applyTerrainLevel2(
    terrainObjects, firstSeenAt, lmcaBase.lastMeaningfulChangeAt, lmcaBase.consecutiveMentionsWithoutChange,
  )

  const stagnationDays = (lastMeaningfulChangeAt && lastSeenAt && lastMeaningfulChangeAt !== lastSeenAt)
    ? Math.floor((new Date(lastSeenAt).getTime() - new Date(lastMeaningfulChangeAt).getTime()) / 86_400_000)
    : 0
  // #228 Lot B — stagnant SEULEMENT si une évolution était ATTENDUE (objet opérationnel ouvert OU
  // réouverture) sur un sujet métier durable (actor exclu). Même règle et même primitive « réouvert »
  // (buildSiteSubjectCells) que la grille → fiche et grille racontent la même histoire. Seuils inchangés.
  const hasOpenOperationalObject =
    terrainObjects.some((t) => isOpenOperationalObjectStatus(t.entityType, t.status)) ||
    materializedEvents.some((e) => isOpenOperationalObjectStatus(e.entityType, e.status))

  // P1-4C2D — composante ACTION de l'activité courante = lifecycle CBO ; NON-action = brut.
  // (hasOpenOperationalObject reste inchangé ci-dessus pour isStagnant : hors périmètre C2D.)
  const rawActionOpen =
    terrainObjects.some((t) => t.entityType === 'site_action' && isOpenOperationalObjectStatus(t.entityType, t.status)) ||
    materializedEvents.some((e) => e.entityType === 'site_action' && isOpenOperationalObjectStatus(e.entityType, e.status))
  const nonActionOpen =
    terrainObjects.some((t) => t.entityType !== 'site_action' && isOpenOperationalObjectStatus(t.entityType, t.status)) ||
    materializedEvents.some((e) => e.entityType !== 'site_action' && isOpenOperationalObjectStatus(e.entityType, e.status))

  // P0-2 — Projection opérationnelle COURANTE partagée (même primitive que le Suivi).
  // displayState (open|resolved|reopened|unknown) est la SEULE vérité d'état courant affichée.
  // currentStatus reste exposé en brut-équivalent (done|open|null) pour isStagnant, mais devient
  // DÉTERMINISTE (issu du tri-state effondré open-dominant), plus jamais dépendant de l'ordre SQL.
  const currentState = deriveCanonicalCurrentState({
    occurrences: displayOccs,
    activeObjectsTotal: activeObjectsTotalForState(subjectCbo, rawActionOpen, nonActionOpen),
  })
  const currentStatus = currentState.triState === 'unknown'
    ? null
    : (currentState.triState === 'resolved' ? 'done' : 'open')

  let isReopened = false
  {
    const { buildSiteSubjectCells, cellDeltaTransition } = await import('@/lib/documents/site-occurrence-timeline')
    const view = await buildSiteSubjectCells(siteId)
    const row = view.rows.find((r) => r.canonicalSubjectId === canonicalSubjectId)
    if (row) {
      const firstIdx = row.cells.findIndex((c) => c !== null)
      let lastIdx = -1
      for (let i = row.cells.length - 1; i >= 0; i--) { if (row.cells[i]) { lastIdx = i; break } }
      if (lastIdx >= 0 && cellDeltaTransition(row.cells[lastIdx]!, lastIdx === firstIdx) === 'réouvert') isReopened = true
    }
  }
  const isStagnant = isStagnationEligible(csKind, hasOpenOperationalObject, isReopened)
    && !CLOSED_NAV_STATUSES.has(currentStatus ?? '')
    && stagnationDays >= 30 && consecutiveMentionsWithoutChange >= 2

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
      source: l.source as SubjectLinkSource,
      justification: l.justification,
      direction: l.direction,
    }
  })

  // Merge metadata
  let mergedIntoLabel: string | null = null
  if (csStatus === 'merged' && csMergedInto) {
    const { data: winnerRow } = await supabase
      .from('canonical_subject')
      .select('label')
      .eq('id', csMergedInto)
      .maybeSingle()
    mergedIntoLabel = (winnerRow as { label: string } | null)?.label ?? null
  }

  const mergesAsWinner: MergeRecord[] = []
  if (csStatus !== 'merged') {
    const { data: mergeRows } = await supabase
      .from('canonical_subject_merge')
      .select('merged_at, resolution_source, suggested_label, snapshot')
      .eq('winner_subject_id', canonicalSubjectId)
      .order('merged_at', { ascending: false })
    for (const row of (mergeRows ?? []) as Array<{ merged_at: string; resolution_source: string; suggested_label: string | null; snapshot: Record<string, unknown> | null }>) {
      const snap = row.snapshot as { loser_label?: string } | null
      mergesAsWinner.push({
        loserLabel: snap?.loser_label ?? '(inconnu)',
        mergedAt: row.merged_at,
        resolutionSource: row.resolution_source as 'llm' | 'manual',
        suggestedLabel: row.suggested_label,
      })
    }
  }

  return {
    canonicalSubjectId,
    siteId,
    label: csLabel,
    aliases: csAliases,
    csStatus,
    mergedInto: csMergedInto,
    mergedIntoLabel,
    mergesAsWinner,
    firstSeenAt,
    lastSeenAt,
    currentStatus,
    displayState: currentState.displayState,
    provenOpen: currentState.provenOpen,
    primaryFamily,
    threadIds,
    pvCount: pvCountHistorical,
    fieldVisitCount: new Set(realOccurrences.filter((o) => o.sourceKind === 'field_visit' || o.sourceKind === 'meeting').map((o) => `${o.sourceKind}-${o.effectiveDate}`)).size,
    runs: allRuns.map((r) => ({ id: r.id, documentId: r.document_id, effectiveDate: runEffectiveDate(r) })),
    occurrences,
    links,
    materializedEvents,
    terrainObjects,
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
    .not('validation_status', 'in', '("rejected","source_superseded")')
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

export type NativeSubjectEvolution = {
  canonicalSubjectId: string
  label: string
  events: Array<{
    date: string
    sourceKind: 'field_visit' | 'meeting'
    labels: string[]
  }>
}

/**
 * Retourne les sujets canoniques actifs ayant ≥ 2 événements métier distincts
 * (sourceKind+effectiveDate) provenant de visites terrain ou réunions.
 * Utilisé par la vue Évolution comme source primaire lorsqu'aucun PV historique n'est présent.
 */
export async function buildNativeEvolutionData(siteId: string): Promise<NativeSubjectEvolution[]> {
  const supabase = createAdminClient()

  type OccRow = {
    canonical_subject_id: string
    effective_date: string
    source_kind: 'field_visit' | 'meeting'
    label: string
  }

  const [{ data: occs }, { data: subjects }] = await Promise.all([
    supabase
      .from('canonical_subject_occurrence')
      .select('canonical_subject_id, effective_date, source_kind, label')
      .eq('site_id', siteId)
      .in('source_kind', ['field_visit', 'meeting'])
      .not('validation_status', 'in', '("rejected","source_superseded")')
      .order('effective_date', { ascending: true }),
    supabase
      .from('canonical_subject')
      .select('id, label')
      .eq('site_id', siteId)
      .eq('status', 'active'),
  ])

  if (!occs?.length || !subjects?.length) return []

  const activeLabels = new Map(
    (subjects as Array<{ id: string; label: string }>).map((s) => [s.id, s.label])
  )

  const subjectMap = new Map<string, {
    label: string
    events: Map<string, { date: string; sourceKind: 'field_visit' | 'meeting'; labels: string[] }>
  }>()

  for (const row of occs as OccRow[]) {
    const sid = row.canonical_subject_id
    if (!activeLabels.has(sid)) continue
    if (!subjectMap.has(sid)) {
      subjectMap.set(sid, { label: activeLabels.get(sid)!, events: new Map() })
    }
    const subject = subjectMap.get(sid)!
    const key = `${row.source_kind}\x00${row.effective_date}`
    if (!subject.events.has(key)) {
      subject.events.set(key, { date: row.effective_date, sourceKind: row.source_kind, labels: [] })
    }
    subject.events.get(key)!.labels.push(row.label)
  }

  return [...subjectMap.entries()]
    .filter(([, s]) => s.events.size >= 2)
    .map(([sid, s]) => ({
      canonicalSubjectId: sid,
      label: s.label,
      events: [...s.events.values()],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
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

// #228 Lot B — STAGNATION_INELIGIBLE (family-based) SUPPRIMÉE : l'éligibilité à la stagnation ne dépend
// plus de la famille d'occurrence mais d'un signal concret d'attente d'évolution (objet opérationnel
// ouvert OU réouverture), via isStagnationEligible (lib/subjects/stagnation.ts). Voir l'audit
// docs/architecture/stagnation-eligibility-audit.md.

// ── Vue liste chantier ────────────────────────────────────────────────────────

export interface NavigableSubjectSummary {
  canonicalSubjectId: string
  title: string
  aliases: string[]
  /** Nature DURABLE du sujet (canonical_subject.kind, mig 355) : actor | business_subject. Seule base
   *  légitime de l'éligibilité opérationnelle (#228). NULL legacy traité comme business (opérationnel). */
  durableKind: 'actor' | 'business_subject' | null
  /** Famille de la 1re occurrence (reservation / action / knowledge_fact / …). INFO DESCRIPTIVE
   *  uniquement — ne décide JAMAIS de l'éligibilité opérationnelle. Anciennement `kind` (#228). */
  dominantFamily: string | null
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
  /** Objets terrain directement liés via canonical_subject_id (actions + échéances, chemin 2B-ter). */
  terrainObjects: TerrainObject[]
  /** État tri-state dérivé de la dernière occurrence non-unknown (open | resolved | unknown). */
  currentTriState: PvState
  /** P0-2 — Projection opérationnelle COURANTE unique (open|resolved|reopened|unknown). Vérité du badge. */
  displayState: CanonicalDisplayState
  /** P0-2 — open OU objet actif rattaché (isProvenOpen). Gate ouvert/fermé partagé. */
  provenOpen: boolean
  /**
   * P2 — Activité DURABLE CBO-aware (0/1) : action via lifecycle CBO (blocksResolution) + non-action
   * brut, MÊME projection que celle qui alimente `deriveCanonicalCurrentState`. Les signaux d'urgence
   * (Attention) doivent lire CECI, pas `activeObjects.total` brut — sinon une `site_action` obsolète
   * d'un CBO complété réactive un faux signal. `activeObjects` (compteurs bruts) reste exposé tel quel.
   */
  activeObjectsCboAware: number
  /**
   * P2-2 — Métriques documentaires GÉNÉRIQUES, source UNIQUE. Calculées sur la CHRONOLOGIE MÉTIER du
   * chantier (dates effectives des PV/visites, JAMAIS created_at). L'Attention et ses consommateurs
   * LISENT ces champs, ils ne les recalculent pas.
   *
   * `presentInLastPv` : le sujet est-il mentionné dans le dernier point documentaire du chantier ?
   * `pvSinceLastMention` : nombre de points documentaires écoulés depuis la dernière mention du sujet
   *   (0 = présent au dernier PV). Le « silence documentaire » (P2-2) = pvSinceLastMention ≥ 2 ET
   *   pertinence durable — il dit UNIQUEMENT « ce sujet pertinent n'est plus mentionné », jamais un état.
   */
  presentInLastPv: boolean
  pvSinceLastMention: number
}

/**
 * P2-2 — Primitive PURE : nombre de points documentaires (dates métier triées, uniques) postérieurs à
 * la dernière mention d'un sujet. `timelineDates` = axe documentaire du chantier (tous PV/visites) trié
 * ASC. `lastSeenAt` = dernière date de mention du sujet. Aucune notion de created_at. 0 si inconnu.
 */
export function pvSinceMentionCount(lastSeenAt: string | null, timelineDates: readonly string[]): number {
  if (!lastSeenAt) return 0
  let n = 0
  for (const d of timelineDates) if (d > lastSeenAt) n++
  return n
}

const CLOSED_NAV_STATUSES = new Set(['done', 'cancelled', 'not_applicable'])

function navSortPriority(s: NavigableSubjectSummary): 0 | 1 | 2 | 3 {
  // #228 : éligibilité opérationnelle = nature DURABLE (actor exclu), plus la famille de la 1re occurrence.
  if (!isOperationalSubject(s.durableKind)) return 2
  // P0-2 — gate ouvert/fermé sur la VÉRITÉ D'ÉTAT COURANT partagée (provenOpen/displayState),
  // plus sur rawStatus : un `unknown` seul ne compte plus comme ouvert (D4), un résolu à objet
  // actif rattaché n'est plus classé fermé (D3). Le tri fin intra-bucket reste ailleurs (rawStatus).
  const isOpen = s.provenOpen
  if (s.isStagnant && isOpen) return 0    // à surveiller
  if (!s.isStagnant && isOpen) return 1   // en évolution active (open OU reopened)
  if (s.displayState === 'resolved') return 3
  return 2                                 // informatif / indéterminé
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

  // P1-4C2D — agrégat CBO par sujet (site entier, un seul appel). Best-effort : en cas d'échec de la
  // couche CBO, subjectCboBySubject vide → retour à la vérité brute des actions (aucune régression).
  let subjectCboBySubject = new Map<string, SubjectCboState>()
  try { subjectCboBySubject = await loadActiveActionCboBySubject(siteId) } catch { subjectCboBySubject = new Map() }

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

  // 2B-bis. Chemin direct : site_action.subject_thread_id (backfill mig 288)
  // Complément de document_proposal_materialization : capture les actions rattachées
  // directement à un thread, indépendamment du run is_canonical qui les a créées.
  // Les IDs s'ajoutent au même Set csEntityIds → le fetch 2C les prend en charge.
  if (allThreadIds.length > 0) {
    for (let i = 0; i < allThreadIds.length; i += 500) {
      const chunk = allThreadIds.slice(i, i + 500)
      const { data: directActs } = await supabase
        .from('site_actions')
        .select('id, subject_thread_id')
        .in('subject_thread_id', chunk)
      for (const a of (directActs ?? []) as Array<{ id: string; subject_thread_id: string }>) {
        const csId = threadToCsId.get(a.subject_thread_id)
        if (!csId) continue
        let typeMap = csEntityIds.get(csId)
        if (!typeMap) { typeMap = new Map(); csEntityIds.set(csId, typeMap) }
        let idSet = typeMap.get('site_action')
        if (!idSet) { idSet = new Set(); typeMap.set('site_action', idSet) }
        idSet.add(a.id)
      }
    }
  }

  // 2B-ter. Chemin direct : site_action/site_deadline.canonical_subject_id (terrain-origin, mig 346)
  // Capture les objets créés depuis le copilote sans PV source ni subject_thread_id.
  // Complémentaire de 2B (materialization) et 2B-bis (subject_thread_id PV).
  // P1-4A : created_at collecté pour Level 2 LMCA (objets terrain apparus après firstSeenAt).
  // P0-B : title+status collectés pour exposer les objets terrain au Copilote desktop.
  const csTerrainObjectsMap = new Map<string, TerrainObject[]>() // canonical_subject_id → objets terrain structurés
  {
    const [{ data: csActs }, { data: csDls }] = await Promise.all([
      supabase.from('site_actions').select('id, canonical_subject_id, created_at, title, status, report_id').eq('site_id', siteId).not('canonical_subject_id', 'is', null),
      supabase.from('site_deadlines').select('id, canonical_subject_id, created_at, title, status, report_id').eq('site_id', siteId).not('canonical_subject_id', 'is', null),
    ])
    const actRows = (csActs ?? []) as Array<{ id: string; canonical_subject_id: string; created_at: string; title: string; status: string | null; report_id: string | null }>
    const dlRows = (csDls ?? []) as Array<{ id: string; canonical_subject_id: string; created_at: string; title: string; status: string | null; report_id: string | null }>
    // Origine des reports → `fromImport` (9+10B), un seul aller-retour pour tout le lot.
    const originByReport = await resolveReportOrigins(supabase, [...actRows.map((a) => a.report_id), ...dlRows.map((d) => d.report_id)])
    const isImport = (reportId: string | null) => reportId != null && isImportedDocumentOrigin(originByReport.get(reportId) ?? null)
    const addEntityId = (csId: string, type: 'site_action' | 'site_deadline', id: string) => {
      let typeMap = csEntityIds.get(csId)
      if (!typeMap) { typeMap = new Map(); csEntityIds.set(csId, typeMap) }
      let idSet = typeMap.get(type)
      if (!idSet) { idSet = new Set(); typeMap.set(type, idSet) }
      idSet.add(id)
    }
    const pushObj = (csId: string, obj: TerrainObject) => {
      const tObjs = csTerrainObjectsMap.get(csId) ?? []
      tObjs.push(obj)
      csTerrainObjectsMap.set(csId, tObjs)
    }
    for (const a of actRows) {
      addEntityId(a.canonical_subject_id, 'site_action', a.id)
      const caDate = a.created_at?.substring(0, 10)
      if (caDate) pushObj(a.canonical_subject_id, { entityType: 'site_action', entityId: a.id, title: a.title, description: null, status: a.status, createdAt: caDate, fromImport: isImport(a.report_id) })
    }
    for (const d of dlRows) {
      addEntityId(d.canonical_subject_id, 'site_deadline', d.id)
      const caDate = d.created_at?.substring(0, 10)
      if (caDate) pushObj(d.canonical_subject_id, { entityType: 'site_deadline', entityId: d.id, title: d.title, description: null, status: d.status, createdAt: caDate, fromImport: isImport(d.report_id) })
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
    .not('validation_status', 'in', '("rejected","source_superseded")')
    .order('effective_date', { ascending: true })
  const nativeOccs = (nativeRaw ?? []) as NativeRow[]

  // 4bis. P2-2 — Axe documentaire du chantier (chronologie métier) : dates effectives de TOUS les PV
  // canoniques ∪ dates des occurrences natives (visites/réunions), uniques et triées ASC. Sert de base
  // unique à pvSinceLastMention/presentInLastPv (jamais created_at). L'absence d'un sujet à un point de
  // cet axe = mesure du silence, pas un événement d'état.
  const siteTimelineDates = [...new Set([
    ...allRuns.map((r) => runEffDate.get(r.id) ?? '').filter(Boolean),
    ...nativeOccs.map((o) => o.effective_date),
  ])].sort()
  const lastSiteDate = siteTimelineDates.at(-1) ?? null

  // 5. Union des CS IDs (PV canoniques ∪ natif)
  const pvCsIds = new Set([...threadToCsId.values()])
  const nativeCsIds = new Set(nativeOccs.map((o) => o.canonical_subject_id))
  const allCsIds = [...new Set([...pvCsIds, ...nativeCsIds])]
  if (allCsIds.length === 0) return []

  // 6. Métadonnées CS (actifs uniquement)
  type CsRow = { id: string; label: string; aliases: string[]; status: string; kind: string | null }
  const { data: csRaw } = await supabase
    .from('canonical_subject')
    .select('id, label, aliases, status, kind')
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

  // 8. R-1 : timeline par CS depuis les OCCURRENCES (états longitudinaux, multiplicité conservée).
  //    Repli propositions uniquement pour les sujets SANS occurrence (acteurs). La présence documentaire
  //    (firstSeen/lastSeen/pvCount) se calcule séparément sur l'axe des runs (§9), indépendamment des états.
  const FAMILY_RANK = ['reservation', 'action', 'decision', 'deadline', 'observation', 'knowledge_fact', 'person', 'company']
  // position (event_date ?? effective_date) pour l'ordre/LMCA ; effectiveDate = date documentaire du PV.
  // rawStatus = statut brut-équivalent (tri-state → done/open/null) pour préserver EXACTEMENT navSortPriority.
  type OccEntry = { position: string; effectiveDate: string; pvState: PvState; rawStatus: string | null; family: string | null; matSig: string }
  const rawEquiv = (s: PvState): string | null => (s === 'resolved' ? 'done' : s === 'open' ? 'open' : null)

  // csId → runId → proposition dominante (repli acteurs + présence documentaire)
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

  // Occurrences historiques du chantier (tous sujets) — source des états.
  const { data: histOccRows } = await supabase
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_ref_id, state_key, state_status, effective_date, event_date')
    .eq('site_id', siteId).eq('source_kind', 'historical_pdf')
    .not('validation_status', 'in', '("rejected","source_superseded")')
  type HistLite = { canonical_subject_id: string; source_ref_id: string; state_key: string; state_status: PvState | null; effective_date: string; event_date: string | null }
  const histLite = (histOccRows ?? []) as HistLite[]
  const navReportIds = [...new Set(histLite.map((o) => o.source_ref_id))]
  const navReportToRun = new Map<string, string>()
  if (navReportIds.length > 0) {
    const { data } = await supabase.from('site_reports').select('id, extraction_run_id').in('id', navReportIds)
    for (const r of (data ?? []) as Array<{ id: string; extraction_run_id: string | null }>) if (r.extraction_run_id) navReportToRun.set(r.id, r.extraction_run_id)
  }
  // cs → run → occurrences
  const occByCsRun = new Map<string, Map<string, HistLite[]>>()
  for (const o of histLite) {
    if (!csById.has(o.canonical_subject_id)) continue
    const run = navReportToRun.get(o.source_ref_id); if (!run) continue
    let rm = occByCsRun.get(o.canonical_subject_id); if (!rm) { rm = new Map(); occByCsRun.set(o.canonical_subject_id, rm) }
    const list = rm.get(run) ?? []; list.push(o); rm.set(run, list)
  }
  // Présence documentaire par cs = runs où le sujet a une occurrence OU une proposition.
  const presenceRunsByCs = new Map<string, Set<string>>()
  for (const [cs, rm] of occByCsRun) presenceRunsByCs.set(cs, new Set(rm.keys()))
  for (const [cs, rm] of bestByCsRun) {
    const set = presenceRunsByCs.get(cs) ?? new Set<string>()
    for (const run of rm.keys()) set.add(run)
    presenceRunsByCs.set(cs, set)
  }

  const occsByCsId = new Map<string, OccEntry[]>()
  for (const csId of csById.keys()) {
    const entries: OccEntry[] = []
    const occRuns = occByCsRun.get(csId)
    if (occRuns && occRuns.size > 0) {
      // Occurrence-backed : un OccEntry par état atomique.
      for (const [run, occs] of occRuns) {
        const rd = runEffDate.get(run) ?? ''
        for (const o of occs) {
          const st: PvState = o.state_status ?? 'unknown'
          entries.push({ position: o.event_date ?? o.effective_date, effectiveDate: rd, pvState: st, rawStatus: rawEquiv(st), family: o.state_key, matSig: matByCsRun.get(csId)?.get(run) ?? '' })
        }
      }
    } else {
      // Repli propositions (acteurs / sujets sans occurrence) : 1 état/run, dominante de famille.
      const runMap = bestByCsRun.get(csId)
      if (runMap) for (const run of allRuns) {
        const e = runMap.get(run.id); if (!e) continue
        const rd = runEffDate.get(run.id) ?? ''
        entries.push({ position: rd, effectiveDate: rd, pvState: documentStatusToPvState(e.status), rawStatus: e.status, family: e.family, matSig: matByCsRun.get(csId)?.get(run.id) ?? '' })
      }
    }
    occsByCsId.set(csId, entries)
  }
  // Occurrences natives (terrain / réunion).
  for (const o of nativeOccs) {
    if (!csById.has(o.canonical_subject_id)) continue
    const list = occsByCsId.get(o.canonical_subject_id) ?? []
    list.push({ position: o.effective_date, effectiveDate: o.effective_date, pvState: visitStatusToPvState(o.visit_status), rawStatus: o.visit_status, family: null, matSig: '' })
    occsByCsId.set(o.canonical_subject_id, list)
  }
  // Tri par position (event_date ?? effective_date), puis date documentaire.
  for (const [csId, occs] of occsByCsId.entries()) {
    occs.sort((a, b) => a.position.localeCompare(b.position) || a.effectiveDate.localeCompare(b.effectiveDate))
    occsByCsId.set(csId, occs)
  }

  // 9. Read-model par CS
  const results: NavigableSubjectSummary[] = []

  // #228 Lot B — réouverture par sujet = transition Chronologie 'réouvert' sur la dernière cellule.
  // MÊME primitive partagée (buildSiteSubjectCells + cellDeltaTransition) que la Chronologie et la
  // simulation p228b → l'éligibilité stagnation « attente d'évolution prouvée » est cohérente partout.
  const reopenedByCs = new Set<string>()
  {
    const { buildSiteSubjectCells, cellDeltaTransition } = await import('@/lib/documents/site-occurrence-timeline')
    const view = await buildSiteSubjectCells(siteId)
    for (const row of view.rows) {
      const firstIdx = row.cells.findIndex((c) => c !== null)
      let lastIdx = -1
      for (let i = row.cells.length - 1; i >= 0; i--) { if (row.cells[i]) { lastIdx = i; break } }
      if (lastIdx >= 0 && cellDeltaTransition(row.cells[lastIdx]!, lastIdx === firstIdx) === 'réouvert') reopenedByCs.add(row.canonicalSubjectId)
    }
  }

  for (const [csId, cs] of csById.entries()) {
    const occs = occsByCsId.get(csId) ?? []
    if (occs.length === 0) continue

    // Présence documentaire : firstSeen/lastSeen/pvCount depuis l'AXE DES RUNS (+ natif), pas les états.
    const presenceRuns = presenceRunsByCs.get(csId) ?? new Set<string>()
    const presenceDates = [...presenceRuns].map((r) => runEffDate.get(r) ?? '').filter(Boolean)
    const nativeDatesCs = occs.filter((o) => o.family === null).map((o) => o.effectiveDate)
    const presenceAll = [...presenceDates, ...nativeDatesCs]
    const firstSeenAt = presenceAll.length ? presenceAll.reduce((a, b) => (a < b ? a : b)) : occs[0].effectiveDate
    const lastSeenAt = presenceAll.length ? presenceAll.reduce((a, b) => (a > b ? a : b)) : occs[occs.length - 1].effectiveDate
    const pvCountHist = presenceRuns.size

    // Statut courant = dernier état DOCUMENTAIRE (max effectiveDate). rawStatus préserve navSortPriority.
    const lastByDate = [...occs].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).slice(-1)[0]
    const currentStatus = lastByDate?.rawStatus ?? null
    // #228 : famille de la 1re occurrence — INFO descriptive uniquement, ne décide plus de l'opérationnel.
    const dominantFamily = occs.find((o) => o.family)?.family ?? null

    // LMCA P1-4A — moteur tri-state unifié, sur la POSITION temporelle (event_date ?? effective_date),
    // effondré par date pour ne pas fabriquer de changement intra-document (multiplicité D1).
    const lmcaOccsB = collapseLmcaOccurrencesByDate(occs.map((occ) => ({
      effectiveDate: occ.position, pvState: occ.pvState, objectSig: occ.matSig,
    })))
    let { lastMeaningfulChangeAt, consecutiveMentionsWithoutChange } = computeLmcaFromOccurrences(lmcaOccsB)

    // Tri-state courant — dernière occurrence non-unknown (open | resolved | unknown)
    const resolvedState = deriveCurrentResolvedState(lmcaOccsB.map(o => o.pvState))
    const currentTriState: PvState = resolvedState === null ? 'unknown' : (resolvedState ? 'resolved' : 'open')

    // Niveau 2 terrain — MÊME primitive que la fiche Sujet (plus de logique dupliquée) :
    // les objets matérialisés-import y sont exclus (fromImport). 9+10B.
    {
      const l2 = applyTerrainLevel2(csTerrainObjectsMap.get(csId) ?? [], firstSeenAt, lastMeaningfulChangeAt, consecutiveMentionsWithoutChange)
      lastMeaningfulChangeAt = l2.lastMeaningfulChangeAt
      consecutiveMentionsWithoutChange = l2.consecutiveMentionsWithoutChange
    }

    const stagnationDays = (lastMeaningfulChangeAt && lastSeenAt && lastMeaningfulChangeAt !== lastSeenAt)
      ? Math.floor((new Date(lastSeenAt).getTime() - new Date(lastMeaningfulChangeAt).getTime()) / 86_400_000)
      : 0
    // #228 Lot B — stagnant SEULEMENT si une évolution était ATTENDUE (objet opérationnel ouvert OU
    // réouverture) sur un sujet métier durable (actor exclu). L'état `open` seul ne suffit pas ; la
    // famille ne décide plus. Conditions temporelles INCHANGÉES (!closed && 30 j && 2 mentions).
    const emStag = csEntityIds.get(csId)
    const hasOpenObject =
      [...(emStag?.get('site_action')   ?? [])].some((id) => OPEN_ACTION_STATUS.has(actionStatusById.get(id) ?? '')) ||
      [...(emStag?.get('site_reserve')  ?? [])].some((id) => OPEN_RESERVE_STATUS.has(reserveStatusById.get(id) ?? '')) ||
      [...(emStag?.get('site_deadline') ?? [])].some((id) => OPEN_DEADLINE_STATUS.has(deadlineStatusById.get(id) ?? '')) ||
      [...(emStag?.get('site_decision') ?? [])].some((id) => OPEN_DECISION_STATUT.has(decisionStatutById.get(id) ?? ''))

    // P1-4C2D — action = lifecycle CBO ; réserve/échéance/décision = brut. hasOpenObject reste
    // inchangé ci-dessus pour isStagnant (hors périmètre C2D).
    const rawActionOpenNav = [...(emStag?.get('site_action') ?? [])].some((id) => OPEN_ACTION_STATUS.has(actionStatusById.get(id) ?? ''))
    const nonActionOpenNav =
      [...(emStag?.get('site_reserve')  ?? [])].some((id) => OPEN_RESERVE_STATUS.has(reserveStatusById.get(id) ?? '')) ||
      [...(emStag?.get('site_deadline') ?? [])].some((id) => OPEN_DEADLINE_STATUS.has(deadlineStatusById.get(id) ?? '')) ||
      [...(emStag?.get('site_decision') ?? [])].some((id) => OPEN_DECISION_STATUT.has(decisionStatutById.get(id) ?? ''))

    // P1-4C2D/P2 — activité durable CBO-aware : action via lifecycle CBO + non-action brut. Calculée
    // UNE fois ici ; alimente P0-2 (activeObjectsTotal) ET exposée (activeObjectsCboAware) pour que
    // l'Attention consomme la MÊME projection au lieu de recalculer ou lire activeObjects brut.
    const activeObjectsCboAware = activeObjectsTotalForState(subjectCboBySubject.get(csId), rawActionOpenNav, nonActionOpenNav)

    // P0-2 — MÊME primitive d'état courant que la fiche. Effondrement open-dominant intra-date,
    // reopened dérivé de la résolution antérieure, provenOpen = open OU objet actif rattaché (C2D : CBO).
    const currentState = deriveCanonicalCurrentState({
      occurrences: occs.map((o) => ({ effectiveDate: o.effectiveDate, pvState: o.pvState })),
      activeObjectsTotal: activeObjectsCboAware,
    })

    const isStagnant = isStagnationEligible(cs.kind, hasOpenObject, reopenedByCs.has(csId))
      && !CLOSED_NAV_STATUSES.has(currentStatus ?? '')
      && stagnationDays >= 30
      && consecutiveMentionsWithoutChange >= 2

    results.push({
      canonicalSubjectId: csId,
      title: cs.label,
      aliases: cs.aliases ?? [],
      durableKind: (cs.kind as 'actor' | 'business_subject' | null) ?? null,
      dominantFamily,
      currentStatus,
      firstSeenAt,
      lastSeenAt,
      lastMeaningfulChangeAt,
      pvCount: pvCountHist,
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
      terrainObjects: csTerrainObjectsMap.get(csId) ?? [],
      currentTriState,
      displayState: currentState.displayState,
      provenOpen: currentState.provenOpen,
      activeObjectsCboAware,
      // P2-2 — chronologie métier (source unique) : nb de PV depuis la dernière mention + présence au dernier PV.
      pvSinceLastMention: pvSinceMentionCount(lastSeenAt, siteTimelineDates),
      presentInLastPv: lastSiteDate != null && lastSeenAt != null && lastSeenAt >= lastSiteDate,
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

// ── Sélecteur liaison manuelle ────────────────────────────────────────────────

export interface CanonicalSubjectSummary {
  id: string
  label: string
  aliases: string[]
  /** 'active' | 'merged' | 'split' */
  status: string
}

// ── Picker navigable ──────────────────────────────────────────────────────────

export interface SubjectPickerItem {
  id: string
  label: string
  aliases: string[]
  /** 'active' | 'merged' | 'split' */
  status: string
  /** Famille principale issue des propositions (null = sujet terrain uniquement) */
  family: string | null
  /** Nombre de PV distincts où ce sujet a été observé */
  pvCount: number
  /** Nombre de PV partagés avec le sujet courant (signal de proximité) */
  coOccurrenceCount: number
}

/**
 * Liste enrichie de tous les sujets opérationnels du chantier pour le picker de liaison.
 * - Exclut le sujet courant et les acteurs (persons/companies).
 * - Calcule pvCount et coOccurrenceCount depuis les propositions et STI.
 */
export async function listSubjectsForPicker(
  siteId: string,
  currentCanonicalSubjectId: string,
): Promise<SubjectPickerItem[]> {
  const supabase = createAdminClient()

  // Canonical subjects du chantier (hors acteurs)
  const { data: csRaw, error: csErr } = await supabase
    .from('canonical_subject')
    .select('id, label, aliases, status')
    .eq('site_id', siteId)
    .is('company_id', null)
    .is('contact_id', null)
    .order('label', { ascending: true })
  if (csErr) throw new Error(csErr.message)
  const allCs = (csRaw ?? []) as Array<{ id: string; label: string; aliases: string[]; status: string }>

  // Runs du chantier
  const runs = await canonicalRunsForSite(siteId)
  if (runs.length === 0) {
    return allCs
      .filter((cs) => cs.id !== currentCanonicalSubjectId)
      .map((cs) => ({ id: cs.id, label: cs.label, aliases: cs.aliases ?? [], status: cs.status, family: null, pvCount: 0, coOccurrenceCount: 0 }))
  }
  const runIds = runs.map((r) => r.id)

  // Propositions (thread + run + family uniquement)
  const { data: propsRaw } = await supabase
    .from('document_extraction_proposal')
    .select('subject_thread_id, extraction_run_id, proposal_family')
    .in('extraction_run_id', runIds)
    .not('subject_thread_id', 'is', null)
  const props = (propsRaw ?? []) as Array<{ subject_thread_id: string; extraction_run_id: string; proposal_family: string }>

  if (props.length === 0) {
    return allCs
      .filter((cs) => cs.id !== currentCanonicalSubjectId)
      .map((cs) => ({ id: cs.id, label: cs.label, aliases: cs.aliases ?? [], status: cs.status, family: null, pvCount: 0, coOccurrenceCount: 0 }))
  }

  // STI pour tous les threads trouvés
  const allThreadIds = [...new Set(props.map((p) => p.subject_thread_id))]
  const { data: stiRaw } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .in('subject_thread_id', allThreadIds)
  const threadToCanonical = new Map<string, string>(
    ((stiRaw ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
      .map((r) => [r.subject_thread_id, r.canonical_subject_id]),
  )

  // Par canonical : runs présents + comptage de famille
  const csRunIds = new Map<string, Set<string>>()
  const csFamilyCounts = new Map<string, Map<string, number>>()
  for (const p of props) {
    const csId = threadToCanonical.get(p.subject_thread_id)
    if (!csId) continue
    if (!csRunIds.has(csId)) csRunIds.set(csId, new Set())
    csRunIds.get(csId)!.add(p.extraction_run_id)
    if (!csFamilyCounts.has(csId)) csFamilyCounts.set(csId, new Map())
    const fc = csFamilyCounts.get(csId)!
    fc.set(p.proposal_family, (fc.get(p.proposal_family) ?? 0) + 1)
  }

  const currentRunIds = csRunIds.get(currentCanonicalSubjectId) ?? new Set<string>()

  return allCs
    .filter((cs) => cs.id !== currentCanonicalSubjectId)
    .map((cs) => {
      const runs = csRunIds.get(cs.id) ?? new Set<string>()
      let coOccurrenceCount = 0
      for (const runId of runs) if (currentRunIds.has(runId)) coOccurrenceCount++
      const fc = csFamilyCounts.get(cs.id)
      let family: string | null = null
      if (fc) {
        let max = 0
        for (const [fam, count] of fc.entries()) if (count > max) { max = count; family = fam }
      }
      return { id: cs.id, label: cs.label, aliases: cs.aliases ?? [], status: cs.status, family, pvCount: runs.size, coOccurrenceCount }
    })
}

/** Liste de tous les sujets opérationnels d'un chantier — pour le sélecteur de liaison manuelle.
 *  Inclut les sujets clôturés (merged/split) afin d'éviter les doublons.
 *  Exclut les acteurs (persons, companies). */
export async function listActiveCanonicalSubjects(siteId: string): Promise<CanonicalSubjectSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('canonical_subject')
    .select('id, label, aliases, status')
    .eq('site_id', siteId)
    .is('company_id', null)
    .is('contact_id', null)
    .order('label', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ id: string; label: string; aliases: string[]; status: string }>).map((r) => ({
    id: r.id,
    label: r.label,
    aliases: r.aliases ?? [],
    status: r.status,
  }))
}
