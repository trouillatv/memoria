// lib/db/knowledge-proposals.ts
// Couche d'extraction métier (migration 212).
//
// La synthèse de visite (site_reports.debrief_analysis) ne reste plus enfermée
// dans son JSON : elle PROJETTE ce qu'elle a compris dans une table générique de
// PROPOSITIONS, visibles partout, distinctes des objets validés. L'humain promeut
// ensuite chaque proposition vers l'objet métier réel par un geste explicite.
//
// Règle produit : « L'IA fait apparaître ce qui mérite l'attention ; l'humain
// décide ce qui devient vrai dans le système. »
//
// Ce module fait DEUX choses (le reste — promotion, surfaces — vit ailleurs) :
//   1. projeter une synthèse en propositions, de façon IDEMPOTENTE ;
//   2. lister / compter les propositions d'un chantier.

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSiteAction } from '@/lib/db/site-actions'
import type { StoredDebriefAnalysis } from '@/lib/visits/debrief-analysis'

export type ProposalKind = 'action' | 'vigilance' | 'decision' | 'knowledge' | 'stakeholder' | 'deadline'
export type ProposalStatus = 'proposed' | 'confirmed' | 'dismissed' | 'superseded'
export type ProposalPayload = Record<string, unknown>

export interface DbKnowledgeProposal {
  id: string
  organization_id: string
  site_id: string
  report_id: string | null
  analysis_version: number
  kind: ProposalKind
  status: ProposalStatus
  title: string
  body: string | null
  payload: ProposalPayload
  confidence: string | null
  source_capture_ids: string[]
  dedupe_key: string
  promoted_object_type: string | null
  promoted_object_id: string | null
  superseded_by: string | null
  dismiss_reason: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
  updated_at: string
}

/** Une proposition telle que dérivée de la synthèse (avant persistance). */
interface DesiredProposal {
  kind: ProposalKind
  title: string
  body: string | null
  payload: ProposalPayload
  dedupe_key: string
}

// ── Normalisation & déduplication ───────────────────────────────
// La clé NE dépend PAS que du titre : chaque type a ses éléments discriminants,
// pour qu'une re-synthèse ne duplique pas et ne ressuscite pas une proposition
// déjà écartée/confirmée.

function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function dedupeKey(kind: ProposalKind, siteId: string, parts: string[]): string {
  const basis = [kind, siteId, ...parts.map(normalize)].join('|')
  return createHash('sha1').update(basis).digest('hex').slice(0, 20)
}

// ── Dérivation : synthèse → propositions souhaitées ─────────────

function buildDesiredProposals(analysis: StoredDebriefAnalysis, siteId: string): DesiredProposal[] {
  const out: DesiredProposal[] = []
  const push = (kind: ProposalKind, title: string, body: string | null, payload: ProposalPayload, keyParts: string[]) => {
    const t = (title ?? '').trim()
    if (!t) return
    out.push({ kind, title: t, body: body?.trim() || null, payload, dedupe_key: dedupeKey(kind, siteId, keyParts) })
  }

  // Actions — grand livre (non écartées) ; repli sur analysis.actions pour les
  // anciennes synthèses sans grand livre. Discriminants : titre + owner + due.
  const ledger = (analysis.action_ledger ?? []).filter((a) => a.state !== 'dismissed')
  if (ledger.length > 0) {
    for (const a of ledger) {
      push('action', a.title, a.rationale, { priority: a.priority, owner: a.owner, due: a.due }, [a.title, a.owner, a.due])
    }
  } else {
    for (const a of analysis.actions ?? []) {
      push('action', a.title, a.rationale, { priority: a.priority, owner: a.owner, due: a.due }, [a.title, a.owner, a.due])
    }
  }

  // Vigilances — fiches. Discriminant : le libellé du risque.
  for (const w of analysis.watchpoints ?? []) {
    push('vigilance', w.label, w.impact, { impact: w.impact, owner: w.owner, due: w.due }, [w.label])
  }

  // Décisions — chaînes. Discriminant : le fait décidé.
  for (const d of analysis.decisions ?? []) {
    push('decision', d, null, {}, [d])
  }

  // Connaissances durables (« à savoir »). Discriminant : le fait normalisé.
  for (const k of analysis.a_savoir ?? []) {
    push('knowledge', k, null, {}, [k])
  }

  // Intervenants détectés. Discriminant : le nom/entité normalisé.
  for (const p of analysis.intervenants ?? []) {
    push('stakeholder', p, null, {}, [p])
  }

  // Échéances détectées. Discriminant : l'échéance normalisée.
  for (const e of analysis.echeances ?? []) {
    push('deadline', e, null, { due_text: e }, [e])
  }

  return out
}

// ── Projection idempotente ──────────────────────────────────────

export interface ProjectResult { inserted: number; refreshed: number; skipped: number }

/**
 * Projette une synthèse en propositions, de façon IDEMPOTENTE :
 *   • proposition nouvelle           → insérée en 'proposed' ;
 *   • déjà présente et 'proposed'     → texte/priorité rafraîchis (la synthèse a
 *                                       pu reformuler) ;
 *   • déjà confirmée / écartée / remplacée → laissée INTACTE (une décision
 *                                       humaine ne se ressuscite jamais).
 * Rien n'est effacé : l'IA ajoute et met à jour, l'humain reste maître.
 */
export async function projectDebriefToProposals(params: {
  reportId: string
  siteId: string
  organizationId: string
  analysis: StoredDebriefAnalysis
}): Promise<ProjectResult> {
  const { reportId, siteId, organizationId, analysis } = params
  const desired = buildDesiredProposals(analysis, siteId)
  if (desired.length === 0) return { inserted: 0, refreshed: 0, skipped: 0 }

  const supabase = createAdminClient()
  const version = analysis.analysis_version ?? 1
  const now = new Date().toISOString()

  const keys = desired.map((d) => d.dedupe_key)
  const { data: existingRows, error: readErr } = await supabase
    .from('site_knowledge_proposals')
    .select('id, dedupe_key, status')
    .eq('site_id', siteId)
    .in('dedupe_key', keys)
  if (readErr) throw readErr
  const byKey = new Map(
    (existingRows ?? []).map((r) => [r.dedupe_key as string, r as { id: string; dedupe_key: string; status: ProposalStatus }]),
  )

  const toInsert: Array<Record<string, unknown>> = []
  let refreshed = 0
  let skipped = 0

  for (const d of desired) {
    const ex = byKey.get(d.dedupe_key)
    if (!ex) {
      toInsert.push({
        organization_id: organizationId,
        site_id: siteId,
        report_id: reportId,
        analysis_version: version,
        kind: d.kind,
        status: 'proposed',
        title: d.title,
        body: d.body,
        payload: d.payload,
        dedupe_key: d.dedupe_key,
      })
      continue
    }
    if (ex.status === 'proposed') {
      const { error: updErr } = await supabase
        .from('site_knowledge_proposals')
        .update({ title: d.title, body: d.body, payload: d.payload, analysis_version: version, updated_at: now })
        .eq('id', ex.id)
      if (updErr) throw updErr
      refreshed++
    } else {
      skipped++
    }
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from('site_knowledge_proposals').insert(toInsert)
    if (insErr) throw insErr
  }

  return { inserted: toInsert.length, refreshed, skipped }
}

// ── Lecture / comptage (pour les surfaces) ──────────────────────

export async function listProposalsBySite(
  siteId: string,
  opts?: { kind?: ProposalKind; status?: ProposalStatus | ProposalStatus[] },
): Promise<DbKnowledgeProposal[]> {
  const supabase = createAdminClient()
  let q = supabase.from('site_knowledge_proposals').select('*').eq('site_id', siteId)
  if (opts?.kind) q = q.eq('kind', opts.kind)
  if (opts?.status) {
    q = Array.isArray(opts.status) ? q.in('status', opts.status) : q.eq('status', opts.status)
  }
  const { data, error } = await q.order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbKnowledgeProposal[]
}

/** Compte les propositions d'un statut donné, par type — pour les compteurs
 *  « 3 actions proposées · 3 vigilances à confirmer » des surfaces. */
export async function countProposalsBySite(
  siteId: string,
  status: ProposalStatus = 'proposed',
): Promise<Record<ProposalKind, number>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('kind')
    .eq('site_id', siteId)
    .eq('status', status)
  if (error) throw error
  const counts: Record<ProposalKind, number> = {
    action: 0, vigilance: 0, decision: 0, knowledge: 0, stakeholder: 0, deadline: 0,
  }
  for (const r of data ?? []) counts[(r as { kind: ProposalKind }).kind]++
  return counts
}

// ── Surfaçage « connaissance » (Sprint Action) ──────────────────
// Les propositions d'action sont visibles DÈS la visite, sans promotion : la
// visite enrichit la CONNAISSANCE du chantier (compteurs « à confirmer »),
// distincte du MÉTIER (site_actions, créées seulement à la promotion). Toutes les
// surfaces (Dashboard, Site, Travail, Mobile) lisent CETTE source unique.

/**
 * PROJECTION UNIQUE de l'objet Action pour un chantier — la SEULE source que toutes
 * les vues (Synthèse, Site, Dashboard, Travail, Historique) consomment ; aucune ne
 * recompte de son côté. Mêle les deux niveaux :
 *   • proposed  = propositions encore à confirmer (connaissance) ;
 *   • confirmed = actions actives (métier : site_actions open/planned) ;
 *   • completed = actions terminées (done) ;
 *   • overdue   = actives dont l'échéance est passée ;
 *   • proposedTop = les premières propositions (titres), pour l'aperçu direct.
 */
export interface ActionProjection {
  proposed: number
  confirmed: number
  completed: number
  overdue: number
  proposedTop: Array<{ id: string; title: string }>
}

export async function getActionProjection(siteId: string, opts?: { topLimit?: number }): Promise<ActionProjection> {
  const supabase = createAdminClient()
  const topLimit = opts?.topLimit ?? 3
  const todayIso = new Date().toISOString().slice(0, 10)
  const [propCountRes, propTopRes, actionsRes] = await Promise.all([
    supabase
      .from('site_knowledge_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId).eq('kind', 'action').eq('status', 'proposed'),
    supabase
      .from('site_knowledge_proposals')
      .select('id, title')
      .eq('site_id', siteId).eq('kind', 'action').eq('status', 'proposed')
      .order('created_at', { ascending: true }).limit(topLimit),
    supabase.from('site_actions').select('status, due_date').eq('site_id', siteId),
  ])
  let confirmed = 0
  let completed = 0
  let overdue = 0
  for (const a of (actionsRes.data ?? []) as Array<{ status: string; due_date: string | null }>) {
    if (a.status === 'done') { completed++; continue }
    if (a.status === 'open' || a.status === 'planned') {
      confirmed++
      if (a.due_date && a.due_date.slice(0, 10) < todayIso) overdue++
    }
  }
  return {
    proposed: propCountRes.count ?? 0,
    confirmed,
    completed,
    overdue,
    proposedTop: ((propTopRes.data ?? []) as Array<{ id: string; title: string }>).map((r) => ({ id: r.id, title: r.title })),
  }
}

/** Idem pour plusieurs chantiers (accueil / dashboard multi-sites) → compte par site. */
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

// ── Décisions humaines : promouvoir / écarter ───────────────────
// « L'humain décide ce qui devient vrai. » Confirmer = PROMOUVOIR la proposition
// vers son objet métier réel (et la marquer 'confirmed', sans la détruire). Écarter
// = 'dismissed' (elle ne réapparaîtra jamais à une re-synthèse — la dédup la reconnaît).

/** Écarte une proposition : décision humaine, jamais ressuscitée. `organizationId`
 *  = garde fail-closed (le service-role bypasse la RLS) : on n'écarte que dans son org. */
export async function dismissProposal(
  id: string,
  reviewedBy: string | null,
  reason?: string,
  organizationId?: string | null,
): Promise<boolean> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()
  let q = supabase
    .from('site_knowledge_proposals')
    .update({ status: 'dismissed', reviewed_at: now, reviewed_by: reviewedBy, dismiss_reason: reason ?? null, updated_at: now })
    .eq('id', id)
    .eq('status', 'proposed') // on n'écarte que ce qui est encore proposé
  if (organizationId) q = q.eq('organization_id', organizationId)
  const { error } = await q
  if (error) throw error
  return true
}

/**
 * Correspondance ledger → proposition (côté serveur) : pour une liste d'actions du
 * grand livre (titre + responsable + échéance), recalcule le `dedupe_key` — IDENTIQUE
 * à celui de la projection — et renvoie l'état de la proposition d'action associée,
 * indexé par la clé du ledger (`key`). Permet à la synthèse de savoir, pour chaque
 * action affichée, si elle est encore proposée / confirmée (promue) / écartée.
 */
export async function getActionProposalStates(
  siteId: string,
  actions: Array<{ key: string; title: string; owner?: string | null; due?: string | null }>,
): Promise<Record<string, { proposalId: string; status: ProposalStatus; promotedObjectType: string | null; promotedObjectId: string | null }>> {
  const out: Record<string, { proposalId: string; status: ProposalStatus; promotedObjectType: string | null; promotedObjectId: string | null }> = {}
  if (actions.length === 0) return out
  // dedupe_key → clé ledger (mêmes parts que buildDesiredProposals : titre, owner, due).
  const ledgerByDedupe = new Map<string, string>()
  for (const a of actions) {
    ledgerByDedupe.set(dedupeKey('action', siteId, [a.title, a.owner ?? '', a.due ?? '']), a.key)
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_knowledge_proposals')
    .select('id, dedupe_key, status, promoted_object_type, promoted_object_id')
    .eq('site_id', siteId)
    .eq('kind', 'action')
    .in('dedupe_key', Array.from(ledgerByDedupe.keys()))
  if (error) throw error
  for (const r of data ?? []) {
    const row = r as { id: string; dedupe_key: string; status: ProposalStatus; promoted_object_type: string | null; promoted_object_id: string | null }
    const ledgerKey = ledgerByDedupe.get(row.dedupe_key)
    if (ledgerKey) {
      out[ledgerKey] = { proposalId: row.id, status: row.status, promotedObjectType: row.promoted_object_type, promotedObjectId: row.promoted_object_id }
    }
  }
  return out
}

export interface PromotionResult { objectType: string; objectId: string }

/**
 * Confirme une proposition en la PROMOUVANT vers son objet métier réel, puis la
 * marque 'confirmed' avec le lien vers l'objet créé. Idempotent : si déjà promue,
 * renvoie l'objet existant sans recréer. Un geste EXPLICITE par type — une vigilance
 * ne devient jamais une réserve automatiquement (portée contractuelle).
 *
 * Aujourd'hui : kind 'action' → site_action. Les autres types (vigilance→site_notes,
 * échéance→obligation, intervenant→site_intervenant, savoir→mémoire) arrivent ensuite.
 */
export async function promoteProposal(params: { id: string; userId: string | null; organizationId?: string | null }): Promise<PromotionResult | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('site_knowledge_proposals').select('*').eq('id', params.id).single()
  if (error || !data) return null
  const p = data as DbKnowledgeProposal

  // Garde fail-closed (le service-role bypasse la RLS) : jamais promouvoir hors de son org.
  if (params.organizationId && p.organization_id && p.organization_id !== params.organizationId) return null

  // Déjà promue : on renvoie l'objet existant (idempotent), on ne recrée rien.
  if (p.status !== 'proposed') {
    return p.promoted_object_type && p.promoted_object_id
      ? { objectType: p.promoted_object_type, objectId: p.promoted_object_id }
      : null
  }

  let result: PromotionResult
  if (p.kind === 'action') {
    const payload = (p.payload ?? {}) as { owner?: string | null }
    const id = await createSiteAction({
      site_id: p.site_id,
      report_id: p.report_id ?? null,
      title: p.title,
      body: p.body,
      assigned_to: payload.owner || null,
      created_by: params.userId,
      created_from: 'visit_debrief_ai',
    })
    result = { objectType: 'site_action', objectId: id }
  } else {
    throw new Error(`Promotion non encore supportée pour le type « ${p.kind} »`)
  }

  const now = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('site_knowledge_proposals')
    .update({
      status: 'confirmed',
      promoted_object_type: result.objectType,
      promoted_object_id: result.objectId,
      reviewed_at: now,
      reviewed_by: params.userId,
      updated_at: now,
    })
    .eq('id', params.id)
  if (updErr) throw updErr
  return result
}
