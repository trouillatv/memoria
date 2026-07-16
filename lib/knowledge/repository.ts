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
import type { VisitSourceSnapshot } from '@/lib/db/visits'
import { EMPTY_SNAPSHOT } from '@/lib/visits/source-snapshot'

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
  /** Quand l'action a été TERMINÉE — `null` tant qu'elle ne l'est pas. Sans cette
   *  date, « terminées récemment » ne peut pas exister : `created_at` dit quand on
   *  l'a écrite, jamais quand on l'a faite. */
  done_at: string | null
}
export async function readSiteActionSummaries(siteId: string): Promise<ActionSummaryRow[]> {
  const { data, error } = await createAdminClient()
    .from('site_actions')
    .select('id, title, status, due_date, created_at, done_at')
    .eq('site_id', siteId)
  if (error) return []
  return (data ?? []) as ActionSummaryRow[]
}

/** État de synthèse de la DERNIÈRE visite terminée — en une lecture (id + fin +
 *  présence d'analyse + verrou de génération). Sans regénérer quoi que ce soit. */
export interface LatestVisitSynthesis {
  reportId: string
  startedAt: string | null
  endedAt: string | null
  hasAnalysis: boolean
  generatingAt: string | null
  /** N° de synthèse (analysis_version) et date de génération, extraits du JSON. */
  version: number | null
  updatedAt: string | null
  /** Empreinte du corpus analysé + ce que la synthèse avait pris en compte. */
  corpusHash: string | null
  sourceSnapshot: VisitSourceSnapshot | null
  /** Trace de la projection en propositions (mig 213) — jamais un échec muet. */
  projectionError: string | null
}
export async function readLatestVisitSynthesis(siteId: string): Promise<LatestVisitSynthesis | null> {
  const { data } = await createAdminClient()
    .from('site_reports')
    .select('id, started_at, ended_at, debrief_analysis, debrief_generating_at, debrief_projection_error')
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
    started_at: string | null
    ended_at: string | null
    debrief_analysis: {
      analysis_version?: number
      generated_at?: string
      corpus_hash?: string
      source_snapshot?: VisitSourceSnapshot
    } | null
    debrief_generating_at: string | null
    debrief_projection_error: string | null
  }
  const a = r.debrief_analysis
  return {
    reportId: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    hasAnalysis: a != null,
    generatingAt: r.debrief_generating_at,
    version: a?.analysis_version ?? null,
    updatedAt: a?.generated_at ?? null,
    corpusHash: a?.corpus_hash ?? null,
    sourceSnapshot: a?.source_snapshot ?? null,
    projectionError: r.debrief_projection_error ?? null,
  }
}

/** Snapshot COURANT de la matière d'une visite — les mêmes compteurs que ceux
 *  figés dans la synthèse (visit_capture, hors éléments écartés). Lecture seule :
 *  on ne régénère jamais une synthèse pour afficher une fiche. */
export async function readVisitSourceSnapshot(reportId: string): Promise<VisitSourceSnapshot> {
  const { data, error } = await createAdminClient()
    .from('visit_capture')
    .select('kind, created_at')
    .eq('report_id', reportId)
    .neq('status', 'discarded')
  if (error) return { ...EMPTY_SNAPSHOT }
  const caps = (data ?? []) as Array<{ kind: string; created_at: string }>
  const countKind = (k: string) => caps.filter((c) => c.kind === k).length
  return {
    photos: countKind('photo'),
    videos: countKind('video'),
    vocals: countKind('vocal'),
    notes: countKind('note'),
    last_capture_at: caps.reduce<string | null>((max, c) => (!max || c.created_at > max ? c.created_at : max), null),
  }
}

// ── CE QUI A BOUGÉ AUJOURD'HUI ───────────────────────────────────────────────
// Le repository DÉCOUVRE quels chantiers ont bougé et QUAND — rien d'autre. Il ne
// compte aucune connaissance : les nombres de l'accueil viennent de SiteOverview,
// jamais d'ici, sinon l'accueil dirait « 2 » quand la fiche dit « 3 ».

/** Un fait daté du jour : une visite finie, une synthèse écrite, une proposition. */
export interface DayEventRow {
  site_id: string
  at: string
  kind: 'visit_ended' | 'synthesis_created' | 'proposal_created'
  /** Type de proposition (`action`, `deadline`…) — absent pour les autres faits. */
  proposal_kind?: string
}

/** Faits datés du jour, pour l'organisation courante. `dayIso` = date civile locale.
 *  Renvoie des LIGNES : le tri, le groupage et les mots sont l'affaire du read model. */
export async function readDayEvents(dayIso: string, orgId: string | null): Promise<DayEventRow[]> {
  const db = createAdminClient()
  // Bornes de la journée civile en zone Nouméa (UTC+11), exprimées en UTC.
  const from = `${dayIso}T00:00:00.000+11:00`
  const to = `${dayIso}T23:59:59.999+11:00`
  const out: DayEventRow[] = []

  let rq = db
    .from('site_reports')
    .select('site_id, ended_at, debrief_analysis')
    .not('site_id', 'is', null)
    .is('deleted_at', null)
    .not('ended_at', 'is', null)
    .gte('ended_at', from)
    .lte('ended_at', to)
  if (orgId) rq = rq.eq('organization_id', orgId)
  const { data: reports } = await rq
  for (const r of (reports ?? []) as Array<{ site_id: string; ended_at: string; debrief_analysis: { generated_at?: string } | null }>) {
    out.push({ site_id: r.site_id, at: r.ended_at, kind: 'visit_ended' })
    const generatedAt = r.debrief_analysis?.generated_at
    // La synthèse n'est un fait que si elle a réellement été écrite AUJOURD'HUI.
    if (generatedAt && generatedAt >= from && generatedAt <= to) {
      out.push({ site_id: r.site_id, at: generatedAt, kind: 'synthesis_created' })
    }
  }

  let pq = db
    .from('site_knowledge_proposals')
    .select('site_id, kind, created_at')
    .eq('status', 'proposed')
    .gte('created_at', from)
    .lte('created_at', to)
  if (orgId) pq = pq.eq('organization_id', orgId)
  const { data: props } = await pq
  for (const p of (props ?? []) as Array<{ site_id: string; kind: string; created_at: string }>) {
    out.push({ site_id: p.site_id, at: p.created_at, kind: 'proposal_created', proposal_kind: p.kind })
  }
  return out
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
