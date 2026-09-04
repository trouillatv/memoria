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
}

/** Niveau 3 — une formulation documentaire BRUTE (site_actions) rattachée au sujet. ARCHIVE, jamais
 *  une charge opérationnelle courante : `status` reste un statut brut de preuve, pas un état durable. */
export interface PilotageFormulation {
  id: string
  title: string
  status: string
  dueDate: string | null
  reportId: string | null
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
    const formulations = formulationsBySubject.get(subjectId) ?? []
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
  const [nav, reduced, rawRows] = await Promise.all([
    getNavigableSubjectsForSite(siteId).catch(() => []),
    loadCboReducedStates(siteId).catch(() => new Map<string, CboReducedEntry>()),
    sb.from('site_actions').select('id, title, status, due_date, report_id, canonical_subject_id').eq('site_id', siteId)
      .then((r) => (r.data ?? []) as RawFormulationRow[], () => [] as RawFormulationRow[]),
  ])
  const ctxById = new Map<string, PilotageSubjectContext>(
    nav.map((n) => [n.canonicalSubjectId, { canonicalSubjectId: n.canonicalSubjectId, title: n.title, displayState: n.displayState, lastMeaningfulChangeAt: n.lastMeaningfulChangeAt, pvCount: n.pvCount }]),
  )
  // N3 — formulations documentaires brutes groupées par sujet (archive ; jamais un état).
  const formulationsBySubject = new Map<string, PilotageFormulation[]>()
  for (const a of rawRows) {
    if (!a.canonical_subject_id) continue
    const l = formulationsBySubject.get(a.canonical_subject_id) ?? []
    l.push({ id: a.id, title: a.title ?? '(sans titre)', status: a.status, dueDate: a.due_date, reportId: a.report_id })
    formulationsBySubject.set(a.canonical_subject_id, l)
  }
  return assembleActionsPilotage(ctxById, reduced.values(), rawRows.length, formulationsBySubject)
}
