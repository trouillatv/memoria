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
