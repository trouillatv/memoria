import 'server-only'

// ── PROJECTION BUILDER ───────────────────────────────────────────────────────
// Construit les projections de la connaissance d'un chantier. LECTURE SEULE, et —
// point important — il ne connaît PAS Supabase : il reçoit des lignes brutes du
// KnowledgeRepository (lib/knowledge/repository.ts) et les agrège/trie. Le sens de
// circulation est strict :
//
//   Repository → lit les tables      (le seul à connaître Supabase)
//   Builder    → agrège/trie          (ce fichier, pur — testable sans base)
//   UI         → affiche la projection
//
// Jamais l'inverse. Une écriture passe par un Promoter / une mutation (qui invalide
// la projection, cf. lib/knowledge/invalidate), jamais par cette couche.
//
// Le cœur du système n'est pas la projection : c'est la CONNAISSANCE du chantier
// (proposée par l'IA, validée par l'humain). La projection n'en est qu'une vue.

import { unstable_cache } from 'next/cache'
import { siteProjectionTag } from '@/lib/knowledge/invalidate'
import {
  readProposedRowsForKind,
  readAllProposedRows,
  readSiteActionRows,
  type ProposalRow,
  type ActionRow,
} from '@/lib/knowledge/repository'
import type { ProposalKind } from '@/lib/db/knowledge-proposals'

// Tri par PERTINENCE : les premières propositions montrées ne sont pas « les 3
// premières de la base » mais les plus importantes → priorité, puis confiance IA,
// puis ancienneté. (L'échéance des actions est un texte libre non triable ici ;
// elle deviendra un critère quand l'objet Échéance sera structuré.)
const PRIORITY_RANK: Record<string, number> = { haute: 0, moyenne: 1, basse: 2 }
const CONFIDENCE_RANK: Record<string, number> = { elevee: 0, moyenne: 1, faible: 2 }

export interface ProposalProjection {
  proposed: number
  proposedTop: Array<{ id: string; title: string }>
}

/** Cœur PUR : ordonne un lot d'éléments proposés par pertinence → ProposalProjection.
 *  Reçoit des lignes (jamais la base). Partagé par le helper par-type ET l'agrégat. */
function buildProposalProjection(rows: ProposalRow[], topLimit: number): ProposalProjection {
  const scored = rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      pr: PRIORITY_RANK[String((r.payload as { priority?: string }).priority ?? '')] ?? 3,
      conf: CONFIDENCE_RANK[r.confidence ?? ''] ?? 3,
      created: r.created_at,
    }))
    .sort((a, b) => a.pr - b.pr || a.conf - b.conf || a.created.localeCompare(b.created))
  return {
    proposed: scored.length,
    proposedTop: scored.slice(0, topLimit).map((s) => ({ id: s.id, title: s.title })),
  }
}

/** Aperçu GÉNÉRIQUE des éléments proposés d'UN type (action, vigilance, échéance…). */
export async function getProposalProjection(
  siteId: string,
  kind: ProposalKind,
  opts?: { topLimit?: number },
): Promise<ProposalProjection> {
  const rows = await readProposedRowsForKind(siteId, kind)
  return buildProposalProjection(rows, opts?.topLimit ?? 3)
}

/** Volet MÉTIER de l'objet Action (site_actions), ajouté à son volet proposition. */
export interface ActionProjection extends ProposalProjection {
  confirmed: number
  completed: number
  overdue: number
}

/** Compteurs métier des actions (open/planned = actives, done = terminées, retard). PUR. */
function buildActionTally(rows: ActionRow[], todayIso: string): { confirmed: number; completed: number; overdue: number } {
  let confirmed = 0
  let completed = 0
  let overdue = 0
  for (const a of rows) {
    if (a.status === 'done') { completed++; continue }
    if (a.status === 'open' || a.status === 'planned') {
      confirmed++
      if (a.due_date && a.due_date.slice(0, 10) < todayIso) overdue++
    }
  }
  return { confirmed, completed, overdue }
}

export async function getActionProjection(siteId: string, opts?: { topLimit?: number }): Promise<ActionProjection> {
  const todayIso = new Date().toISOString().slice(0, 10)
  const [proposal, actionRows] = await Promise.all([
    getProposalProjection(siteId, 'action', opts),
    readSiteActionRows(siteId),
  ])
  return { ...proposal, ...buildActionTally(actionRows, todayIso) }
}

/**
 * PROJECTION AGRÉGÉE DU CHANTIER — UNE lecture des éléments proposés (tous types) +
 * UNE des actions. Aujourd'hui seul `actions` a son volet métier ; les autres
 * exposent leur volet proposition. NB : à terme, les ÉCRANS passent par des read
 * models dédiés (getSiteOverview…) qui composent ces projections ; getSiteProjection
 * n'est PAS destiné à devenir l'agrégat universel de toute l'app.
 */
export interface SiteProjection {
  actions: ActionProjection
  deadlines: ProposalProjection
  watchpoints: ProposalProjection
  knowledge: ProposalProjection
  stakeholders: ProposalProjection
  decisions: ProposalProjection
}

/** Agrégat vide — fallback sûr pour les écrans. */
export function emptySiteProjection(): SiteProjection {
  const empty: ProposalProjection = { proposed: 0, proposedTop: [] }
  return {
    actions: { ...empty, confirmed: 0, completed: 0, overdue: 0 },
    deadlines: { ...empty },
    watchpoints: { ...empty },
    knowledge: { ...empty },
    stakeholders: { ...empty },
    decisions: { ...empty },
  }
}

async function computeSiteProjection(siteId: string, topLimit: number): Promise<SiteProjection> {
  const todayIso = new Date().toISOString().slice(0, 10)
  const [propRows, actionRows] = await Promise.all([
    readAllProposedRows(siteId),
    readSiteActionRows(siteId),
  ])
  const byKind: Record<ProposalKind, ProposalRow[]> = {
    action: [], vigilance: [], decision: [], knowledge: [], stakeholder: [], deadline: [],
  }
  for (const r of propRows) byKind[r.kind]?.push(r)
  const action = buildProposalProjection(byKind.action, topLimit)
  return {
    actions: { ...action, ...buildActionTally(actionRows, todayIso) },
    deadlines: buildProposalProjection(byKind.deadline, topLimit),
    watchpoints: buildProposalProjection(byKind.vigilance, topLimit),
    knowledge: buildProposalProjection(byKind.knowledge, topLimit),
    stakeholders: buildProposalProjection(byKind.stakeholder, topLimit),
    decisions: buildProposalProjection(byKind.decision, topLimit),
  }
}

/**
 * Projection agrégée du chantier, MISE EN CACHE (cross-requête, TTL 30 s) et
 * étiquetée par chantier. Une mutation appelle `invalidateSiteProjection(siteId)`
 * (cf. lib/knowledge/invalidate) → le cache tombe → tous les écrans se recomposent.
 */
export function getSiteProjection(siteId: string, opts?: { topLimit?: number }): Promise<SiteProjection> {
  const topLimit = opts?.topLimit ?? 3
  return unstable_cache(
    () => computeSiteProjection(siteId, topLimit),
    ['site-projection', siteId, String(topLimit)],
    { tags: [siteProjectionTag(siteId)], revalidate: 30 },
  )()
}

// Re-export (continuité pour les appelants existants) : l'accès data vit dans le repository.
export { countProposedActionsForSites } from '@/lib/knowledge/repository'
