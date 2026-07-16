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
