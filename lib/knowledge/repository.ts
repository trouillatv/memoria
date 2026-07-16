import 'server-only'

// ── KNOWLEDGE REPOSITORY ─────────────────────────────────────────────────────
// SEUL endroit qui connaît Supabase et les tables de la connaissance. Il renvoie
// des LIGNES brutes ; il ne calcule rien, ne trie rien, n'agrège rien. Le
// ProjectionBuilder (lib/knowledge/projection.ts) reçoit ces lignes et construit
// les projections SANS jamais toucher la base. Cette séparation devient essentielle
// quand il y aura Dashboard / Mission / Société / Utilisateur : un seul accès data,
// une logique de projection pure et testable.

import { createAdminClient } from '@/lib/supabase/admin'
import type { ProposalKind, ProposalPayload } from '@/lib/db/knowledge-proposals'

/** Ligne brute d'un élément de connaissance PROPOSÉ (avant tri/agrégation). */
export interface ProposalRow {
  id: string
  title: string
  payload: ProposalPayload
  confidence: string | null
  created_at: string
}

/** Ligne brute d'action métier (pour les compteurs actives/terminées/retard). */
export interface ActionRow {
  status: string
  due_date: string | null
}

/** Éléments proposés d'UN type pour un chantier. */
export async function readProposedRowsForKind(siteId: string, kind: ProposalKind): Promise<ProposalRow[]> {
  const { data, error } = await createAdminClient()
    .from('site_knowledge_proposals')
    .select('id, title, payload, confidence, created_at')
    .eq('site_id', siteId).eq('kind', kind).eq('status', 'proposed')
  if (error) return []
  return (data ?? []) as ProposalRow[]
}

/** TOUS les éléments proposés d'un chantier, tous types (une seule lecture). */
export async function readAllProposedRows(siteId: string): Promise<Array<ProposalRow & { kind: ProposalKind }>> {
  const { data, error } = await createAdminClient()
    .from('site_knowledge_proposals')
    .select('id, kind, title, payload, confidence, created_at')
    .eq('site_id', siteId).eq('status', 'proposed')
  if (error) return []
  return (data ?? []) as Array<ProposalRow & { kind: ProposalKind }>
}

/** Lignes brutes des actions métier d'un chantier (statut + échéance). */
export async function readSiteActionRows(siteId: string): Promise<ActionRow[]> {
  const { data, error } = await createAdminClient()
    .from('site_actions')
    .select('status, due_date')
    .eq('site_id', siteId)
  if (error) return []
  return (data ?? []) as ActionRow[]
}

/** Résumés des actions métier (id + titre + statut + échéance + création) — pour la
 *  liste des actions actives, le tally et le tri des actions sans échéance. */
export interface ActionSummaryRow {
  id: string
  title: string
  status: string
  due_date: string | null
  created_at: string
}
export async function readSiteActionSummaries(siteId: string): Promise<ActionSummaryRow[]> {
  const { data, error } = await createAdminClient()
    .from('site_actions')
    .select('id, title, status, due_date, created_at')
    .eq('site_id', siteId)
  if (error) return []
  return (data ?? []) as ActionSummaryRow[]
}

/** État de synthèse de la DERNIÈRE visite terminée — en une lecture (id + fin +
 *  présence d'analyse + verrou de génération). Sans regénérer quoi que ce soit. */
export interface LatestVisitSynthesis {
  reportId: string
  endedAt: string | null
  hasAnalysis: boolean
  generatingAt: string | null
  /** N° de synthèse (analysis_version) et date de génération, extraits du JSON. */
  version: number | null
  updatedAt: string | null
}
export async function readLatestVisitSynthesis(siteId: string): Promise<LatestVisitSynthesis | null> {
  const { data } = await createAdminClient()
    .from('site_reports')
    .select('id, ended_at, debrief_analysis, debrief_generating_at')
    .eq('site_id', siteId)
    .not('origin', 'is', null)
    .is('deleted_at', null)
    .not('ended_at', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const r = data as {
    id: string
    ended_at: string | null
    debrief_analysis: { analysis_version?: number; generated_at?: string } | null
    debrief_generating_at: string | null
  }
  const a = r.debrief_analysis
  return {
    reportId: r.id,
    endedAt: r.ended_at,
    hasAnalysis: a != null,
    generatingAt: r.debrief_generating_at,
    version: a?.analysis_version ?? null,
    updatedAt: a?.generated_at ?? null,
  }
}

/** Compte des actions proposées pour PLUSIEURS chantiers (accueil multi-sites). */
export async function countProposedActionsForSites(siteIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  if (siteIds.length === 0) return out
  const { data, error } = await createAdminClient()
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
