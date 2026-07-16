import 'server-only'

// ── COUCHE PROJECTION ────────────────────────────────────────────────────────
// LECTURE SEULE de la connaissance d'un chantier. Cette couche NE fait JAMAIS :
// pas de calcul métier décisionnel, pas de promotion, pas de mutation. Le sens de
// circulation est strict :
//
//   Promoter → écrit les objets   (site_actions, propositions…)
//   Projection → LIT les objets    (ce fichier)
//   UI → affiche la projection
//
// Jamais l'inverse. Si un écran a besoin d'écrire, il passe par un Promoter / une
// server action, jamais par la projection.
//
// Le cœur du système n'est pas la projection : c'est la CONNAISSANCE du chantier
// (proposée par l'IA, validée par l'humain). La projection n'en est que la dernière
// étape — une vue. À terme cette couche portera d'autres agrégats (visite, mission,
// entreprise…) ; c'est pour ça qu'elle vit dans son propre module.

import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { siteProjectionTag } from '@/lib/knowledge/invalidate'
import type { ProposalKind, ProposalPayload } from '@/lib/db/knowledge-proposals'

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

interface ScorableProposalRow {
  id: string
  title: string
  payload: ProposalPayload
  confidence: string | null
  created_at: string
}

/** Cœur PUR : ordonne un lot de propositions par pertinence → ProposalProjection.
 *  Partagé par le helper par-type ET l'agrégat chantier (une seule logique de tri). */
function projectProposalRows(rows: ScorableProposalRow[], topLimit: number): ProposalProjection {
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

/** Aperçu GÉNÉRIQUE de propositions d'UN type (action, vigilance, échéance…). */
export async function getProposalProjection(
  siteId: string,
  kind: ProposalKind,
  opts?: { topLimit?: number },
): Promise<ProposalProjection> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('id, title, payload, confidence, created_at')
    .eq('site_id', siteId).eq('kind', kind).eq('status', 'proposed')
  if (error) return { proposed: 0, proposedTop: [] }
  return projectProposalRows((data ?? []) as ScorableProposalRow[], opts?.topLimit ?? 3)
}

/** Volet MÉTIER de l'objet Action (site_actions), ajouté à son volet proposition. */
export interface ActionProjection extends ProposalProjection {
  confirmed: number
  completed: number
  overdue: number
}

/** Compteurs métier des site_actions (open/planned = actives, done = terminées, retard). */
function tallyActionRows(rows: Array<{ status: string; due_date: string | null }>, todayIso: string): { confirmed: number; completed: number; overdue: number } {
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
  const supabase = createAdminClient()
  const todayIso = new Date().toISOString().slice(0, 10)
  const [proposal, actionsRes] = await Promise.all([
    getProposalProjection(siteId, 'action', opts),
    supabase.from('site_actions').select('status, due_date').eq('site_id', siteId),
  ])
  return { ...proposal, ...tallyActionRows((actionsRes.data ?? []) as Array<{ status: string; due_date: string | null }>, todayIso) }
}

/**
 * PROJECTION AGRÉGÉE DU CHANTIER — le point d'entrée unique des ÉCRANS (Dashboard,
 * fiche chantier) qui affichent plusieurs objets. UNE lecture des propositions (tous
 * types) + UNE des site_actions, au lieu d'un helper par bloc. Aujourd'hui seul
 * `actions` a son volet métier ; les autres exposent déjà leur volet proposition.
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
  const supabase = createAdminClient()
  const todayIso = new Date().toISOString().slice(0, 10)
  const [propRes, actionsRes] = await Promise.all([
    supabase
      .from('site_knowledge_proposals')
      .select('id, kind, title, payload, confidence, created_at')
      .eq('site_id', siteId).eq('status', 'proposed'),
    supabase.from('site_actions').select('status, due_date').eq('site_id', siteId),
  ])
  const byKind: Record<ProposalKind, ScorableProposalRow[]> = {
    action: [], vigilance: [], decision: [], knowledge: [], stakeholder: [], deadline: [],
  }
  for (const r of (propRes.data ?? []) as Array<ScorableProposalRow & { kind: ProposalKind }>) {
    byKind[r.kind]?.push(r)
  }
  const action = projectProposalRows(byKind.action, topLimit)
  return {
    actions: { ...action, ...tallyActionRows((actionsRes.data ?? []) as Array<{ status: string; due_date: string | null }>, todayIso) },
    deadlines: projectProposalRows(byKind.deadline, topLimit),
    watchpoints: projectProposalRows(byKind.vigilance, topLimit),
    knowledge: projectProposalRows(byKind.knowledge, topLimit),
    stakeholders: projectProposalRows(byKind.stakeholder, topLimit),
    decisions: projectProposalRows(byKind.decision, topLimit),
  }
}

/**
 * Projection agrégée du chantier, MISE EN CACHE (cross-requête, TTL 30 s) et
 * étiquetée par chantier. Toutes les surfaces (Accueil, Dashboard, Site, Travail,
 * Planning) appellent ceci sans multiplier les requêtes DB. Une mutation appelle
 * `invalidateSiteProjection(siteId)` (cf. lib/knowledge/invalidate) → le cache tombe
 * → tous les écrans se recomposent, sans code spécifique par écran.
 */
export function getSiteProjection(siteId: string, opts?: { topLimit?: number }): Promise<SiteProjection> {
  const topLimit = opts?.topLimit ?? 3
  return unstable_cache(
    () => computeSiteProjection(siteId, topLimit),
    ['site-projection', siteId, String(topLimit)],
    { tags: [siteProjectionTag(siteId)], revalidate: 30 },
  )()
}

/** Compte des actions proposées pour PLUSIEURS chantiers (accueil multi-sites). */
export async function countProposedActionsForSites(siteIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  if (siteIds.length === 0) return out
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('site_id')
    .in('site_id', siteIds)
    .eq('kind', 'action')
    .eq('status', 'proposed')
  if (error) return out
  for (const r of (data ?? []) as Array<{ site_id: string }>) {
    out[r.site_id] = (out[r.site_id] ?? 0) + 1
  }
  return out
}
