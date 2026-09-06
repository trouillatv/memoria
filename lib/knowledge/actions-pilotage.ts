import 'server-only'

// V1-1/V1-2 — READ-MODEL D'ASSEMBLAGE « Actions à piloter » (SUJET → CBO → historique).
//
// Objectif produit : David voit ses SUJETS canoniques (niveau 1) puis, à l'intérieur, les OBJETS
// métier durables CBO (niveau 2) avec leur état C2A ; les formulations documentaires brutes
// (site_actions, niveau 3) restent accessibles mais ne sont plus la liste principale.
//
// N'INTRODUIT AUCUNE VÉRITÉ : compose des primitives GELÉES.
//   - `getNavigableSubjectsForSite` (P0-2/C2D) → état SUJET (displayState), dernière évolution, PV.
//   - `loadCboReducedBySubject` (C2A/C2D) → CBO action réduits par sujet (computedCurrentState…).
//   - `isActiveCboState`/`isTerminalCboState` (classes C2A gelées) → classification actif/terminé.
//   - `site_actions` (brut) → COMPTE des formulations historiques (jamais un état).
// Aucun recalcul d'état ici ; aucun usage de subject_thread_id ; unknown reste unknown.

import { createAdminClient } from '@/lib/supabase/admin'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import { loadCboReducedStates } from '@/lib/knowledge/canonical-business-object-evolution'
import type { CboReducedEntry } from '@/lib/knowledge/canonical-business-object-evolution'
import { isActiveCboState, isTerminalCboState, type CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'
import type { CanonicalDisplayState } from '@/lib/documents/subject-state'
import { canonicalRunsForSite } from '@/lib/documents/pv-history'

/** Niveau 2 — un objet métier durable (CBO action) et son état C2A autoritatif. */
export interface PilotageCbo {
  cboId: string
  label: string
  computedCurrentState: CboComputedCurrentState
  /** actif = open/reopened/progressing (à piloter). */
  active: boolean
  /** terminé = completed/cancelled/conforme. */
  terminal: boolean
  stateBasis: string[]
  conflicts: string[]
  documentaryDivergences: string[]
  /** P3-Actions-Lot1 — membre site_action déterministe portant le geste humain close/reopen. */
  targetActionId: string | null
}

/** Niveau 3 — une formulation documentaire BRUTE (site_actions) rattachée au sujet. ARCHIVE, jamais
 *  une charge opérationnelle courante : `status` reste un statut brut de preuve, pas un état durable.
 *  P0-UX (Vincent 2026-09-06) : chaque formulation porte SA provenance — date métier du PV,
 *  libellé (« PV 8 »), lien vers la source — car MemorIA repose sur la preuve. */
export interface PilotageFormulation {
  id: string
  title: string
  status: string
  dueDate: string | null
  reportId: string | null
  /** Date MÉTIER du PV source (documents.effective_date) — null si introuvable. */
  pvDate: string | null
  /** Libellé court de la source : « PV 8 » (numérotation = ordre des runs canoniques,
   *  la même que Suivi/Lignes de vie), sinon « Réunion » / « Visite ». */
  pvLabel: string | null
  /** Lien vers la source (convention fiche sujet : PDF→/documents, visite→/visites, réunion→/reunion). */
  pvHref: string | null
}

/** Niveau 1 — un sujet canonique porteur d'actions, avec le résumé de ses CBO. */
export interface PilotageSubject {
  canonicalSubjectId: string
  label: string
  /** Vérité SUJET (P0-2/C2D), consommée telle quelle. */
  displayState: CanonicalDisplayState
  activeCboCount: number
  completedCboCount: number
  unknownCboCount: number
  totalCboCount: number
  lastMeaningfulChangeAt: string | null
  pvCount: number
  cbos: PilotageCbo[]
  /** N3 — formulations documentaires brutes du sujet + nombre de PV distincts. Archive repliée. */
  formulations: PilotageFormulation[]
  formulationPvCount: number
}

/** KPI Aperçu — raconte les DEUX niveaux, sans jamais appeler les sujets « actions »
 *  ni assimiler unknown à ouvert. `historicalFormulations` = compte brut site_actions. */
export interface PilotageKpi {
  subjectsWithActions: number
  /** Compté sur TOUS les CBO action du site (rattachés ou non à un sujet). */
  activeCbo: number
  completedCbo: number
  /** unknown (+ conflict) : « à qualifier », JAMAIS des ouverts. Inclut les CBO dangling
   *  (sans canonical_subject_id) qui n'apparaissent dans aucun sujet — dette d'intégrité connue. */
  toQualifyCbo: number
  /** CBO « à qualifier » non rattachés à un sujet (dangling) : sous-ensemble de toQualifyCbo. */
  unattachedCbo: number
  totalCbo: number
  historicalFormulations: number
}

export interface SiteActionsPilotage {
  kpi: PilotageKpi
  subjects: PilotageSubject[]
}

export function emptyActionsPilotage(): SiteActionsPilotage {
  return { kpi: { subjectsWithActions: 0, activeCbo: 0, completedCbo: 0, toQualifyCbo: 0, unattachedCbo: 0, totalCbo: 0, historicalFormulations: 0 }, subjects: [] }
}

/**
 * Assemble la vue « Actions à piloter » d'un chantier. READ-ONLY, ne throw pas (replis).
 * Ordre des sujets : d'abord ceux qui ont des CBO actifs, puis par dernière évolution récente.
 */
const cboOf = (e: CboReducedEntry): PilotageCbo => {
  const st = e.reduced.computedCurrentState
  return {
    cboId: e.cboId, label: e.label, computedCurrentState: st,
    active: isActiveCboState(st), terminal: isTerminalCboState(st),
    stateBasis: e.reduced.stateBasis, conflicts: e.reduced.conflicts, documentaryDivergences: e.reduced.documentaryDivergences,
    targetActionId: e.targetActionId,
  }
}

/** Contexte SUJET minimal consommé (sous-ensemble de NavigableSubjectSummary). */
export interface PilotageSubjectContext {
  canonicalSubjectId: string
  title: string
  displayState: CanonicalDisplayState
  lastMeaningfulChangeAt: string | null
  pvCount: number
}

/**
 * Assemblage PUR (aucune DB) : KPI sur TOUS les CBO (dont dangling sans sujet) + liste des sujets
 * porteurs de CBO rattachés. Déterministe. Testable seul.
 */
export function assembleActionsPilotage(
  subjectCtxById: Map<string, PilotageSubjectContext>,
  reduced: Iterable<CboReducedEntry>,
  historicalFormulations: number,
  formulationsBySubject: Map<string, PilotageFormulation[]> = new Map(),
): SiteActionsPilotage {
  let activeCbo = 0, completedCbo = 0, toQualifyCbo = 0, totalCbo = 0, unattachedCbo = 0
  const bySubject = new Map<string, CboReducedEntry[]>()
  for (const e of reduced) {
    const st = e.reduced.computedCurrentState
    totalCbo++
    if (isActiveCboState(st)) activeCbo++
    else if (isTerminalCboState(st)) completedCbo++
    else toQualifyCbo++ // unknown + conflict = « à qualifier », jamais des ouverts
    if (e.canonicalSubjectId) {
      const l = bySubject.get(e.canonicalSubjectId) ?? []; l.push(e); bySubject.set(e.canonicalSubjectId, l)
    } else if (!isActiveCboState(st) && !isTerminalCboState(st)) {
      unattachedCbo++ // dangling « à qualifier » sans sujet → compté en KPI, absent des sujets
    }
  }

  const subjects: PilotageSubject[] = []
  for (const [subjectId, entries] of bySubject) {
    const cbos = entries.map(cboOf).sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label))
    const activeCount = cbos.filter((c) => c.active).length
    const completedCount = cbos.filter((c) => c.terminal).length
    const ctx = subjectCtxById.get(subjectId)
    // Provenance d'abord : du PV le plus récent au plus ancien (dates métier), les
    // formulations sans date en fin — on lit l'histoire à rebours, comme la fiche sujet.
    const formulations = [...(formulationsBySubject.get(subjectId) ?? [])].sort((a, b) =>
      (b.pvDate ?? '').localeCompare(a.pvDate ?? '') || a.title.localeCompare(b.title))
    subjects.push({
      canonicalSubjectId: subjectId,
      label: ctx?.title ?? entries[0]?.label ?? '(sujet)',
      displayState: ctx?.displayState ?? 'unknown',
      activeCboCount: activeCount, completedCboCount: completedCount,
      unknownCboCount: cbos.length - activeCount - completedCount, totalCboCount: cbos.length,
      lastMeaningfulChangeAt: ctx?.lastMeaningfulChangeAt ?? null,
      pvCount: ctx?.pvCount ?? 0,
      cbos,
      formulations,
      formulationPvCount: new Set(formulations.map((f) => f.reportId).filter(Boolean)).size,
    })
  }

  // Sujets à piloter d'abord (≥1 CBO actif), puis dernière évolution récente, puis label.
  subjects.sort((a, b) =>
    Number(b.activeCboCount > 0) - Number(a.activeCboCount > 0)
    || (b.lastMeaningfulChangeAt ?? '').localeCompare(a.lastMeaningfulChangeAt ?? '')
    || a.label.localeCompare(b.label))

  return {
    kpi: { subjectsWithActions: subjects.length, activeCbo, completedCbo, toQualifyCbo, unattachedCbo, totalCbo, historicalFormulations },
    subjects,
  }
}

/** V1-1 — KPI seul (Aperçu), sans charger l'état SUJET : les compteurs se dérivent des CBO. Léger. */
export async function getActionsPilotageKpi(siteId: string): Promise<PilotageKpi> {
  const sb = createAdminClient()
  const [reduced, rawCount] = await Promise.all([
    loadCboReducedStates(siteId).catch(() => new Map<string, CboReducedEntry>()),
    sb.from('site_actions').select('id', { count: 'exact', head: true }).eq('site_id', siteId).then((r) => r.count ?? 0, () => 0),
  ])
  return assembleActionsPilotage(new Map(), reduced.values(), rawCount).kpi
}

type RawFormulationRow = { id: string; title: string | null; status: string; due_date: string | null; report_id: string | null; canonical_subject_id: string | null }

export async function getSiteActionsPilotage(siteId: string): Promise<SiteActionsPilotage> {
  const sb = createAdminClient()
  const [nav, reduced, rawRows, runs] = await Promise.all([
    getNavigableSubjectsForSite(siteId).catch(() => []),
    loadCboReducedStates(siteId).catch(() => new Map<string, CboReducedEntry>()),
    sb.from('site_actions').select('id, title, status, due_date, report_id, canonical_subject_id').eq('site_id', siteId)
      .then((r) => (r.data ?? []) as RawFormulationRow[], () => [] as RawFormulationRow[]),
    // Numérotation PV = ordre des runs canoniques (la même que Suivi/Lignes de vie). cache() C1.
    canonicalRunsForSite(siteId).catch(() => []),
  ])
  const ctxById = new Map<string, PilotageSubjectContext>(
    nav.map((n) => [n.canonicalSubjectId, { canonicalSubjectId: n.canonicalSubjectId, title: n.title, displayState: n.displayState, lastMeaningfulChangeAt: n.lastMeaningfulChangeAt, pvCount: n.pvCount }]),
  )

  // P0-UX — provenance des formulations : report → (origin, run, document) → date métier,
  // n° de PV, lien source. 2 requêtes batchées, jamais une par formulation.
  const pvNumberByRun = new Map<string, number>(runs.map((r, i) => [r.id, i + 1]))
  const reportIds = [...new Set(rawRows.map((a) => a.report_id).filter((x): x is string => !!x))]
  type ReportRow = { id: string; origin: string | null; extraction_run_id: string | null; source_document_id: string | null }
  const reports = new Map<string, ReportRow>()
  if (reportIds.length > 0) {
    const { data } = await sb.from('site_reports').select('id, origin, extraction_run_id, source_document_id').in('id', reportIds)
    for (const r of (data ?? []) as ReportRow[]) reports.set(r.id, r)
  }
  const docIds = [...new Set([...reports.values()].map((r) => r.source_document_id).filter((x): x is string => !!x))]
  const docDate = new Map<string, string>()
  if (docIds.length > 0) {
    const { data } = await sb.from('documents').select('id, effective_date').in('id', docIds)
    for (const d of (data ?? []) as Array<{ id: string; effective_date: string | null }>) if (d.effective_date) docDate.set(d.id, d.effective_date)
  }
  const provenanceOf = (reportId: string | null): Pick<PilotageFormulation, 'pvDate' | 'pvLabel' | 'pvHref'> => {
    const r = reportId ? reports.get(reportId) : undefined
    if (!r) return { pvDate: null, pvLabel: null, pvHref: null }
    const pvDate = r.source_document_id ? docDate.get(r.source_document_id) ?? null : null
    if (r.source_document_id) {
      const n = r.extraction_run_id ? pvNumberByRun.get(r.extraction_run_id) : undefined
      return { pvDate, pvLabel: n ? `PV ${n}` : 'PV', pvHref: `/documents/${r.source_document_id}` }
    }
    // Report natif (convention fiche sujet) : réunion → /reunion, sinon visite → /visites.
    const isMeeting = (r.origin ?? '').includes('meeting')
    return { pvDate, pvLabel: isMeeting ? 'Réunion' : 'Visite', pvHref: `/sites/${siteId}/${isMeeting ? 'reunion' : 'visites'}/${r.id}` }
  }

  // N3 — formulations documentaires brutes groupées par sujet (archive ; jamais un état).
  const formulationsBySubject = new Map<string, PilotageFormulation[]>()
  for (const a of rawRows) {
    if (!a.canonical_subject_id) continue
    const l = formulationsBySubject.get(a.canonical_subject_id) ?? []
    l.push({ id: a.id, title: a.title ?? '(sans titre)', status: a.status, dueDate: a.due_date, reportId: a.report_id, ...provenanceOf(a.report_id) })
    formulationsBySubject.set(a.canonical_subject_id, l)
  }
  return assembleActionsPilotage(ctxById, reduced.values(), rawRows.length, formulationsBySubject)
}
