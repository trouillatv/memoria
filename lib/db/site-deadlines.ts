import 'server-only'

// ── ÉCHÉANCES CHANTIER (mig 215) ─────────────────────────────────────────────
// Une échéance = ce qui doit arriver, et le temps qui va avec. Deux formes du
// « quand », jamais confondues : une DATE dite, ou une CONTRAINTE dite.
//
// Une échéance sans date n'est pas incomplète : elle est « à planifier ». C'est un
// état de travail normal — le conducteur a confirmé que le sujet existe, il n'a pas
// encore décidé du jour. On ne lui arrache pas une date pour faire joli.

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'

export type DeadlineStatus = 'to_plan' | 'planned' | 'done' | 'cancelled' | 'superseded'

/** Motifs d'annulation d'une échéance DÉJÀ validée (≠ rejet d'une proposition). */
export type DeadlineCancelReason =
  | 'abandoned' | 'superseded' | 'done_otherwise' | 'bad_extraction' | 'not_needed' | 'other'

export const CANCEL_REASON_LABEL: Record<DeadlineCancelReason, string> = {
  abandoned: 'Travaux abandonnés',
  superseded: 'Remplacée par une autre échéance',
  done_otherwise: 'Déjà réalisée autrement',
  bad_extraction: 'Mauvaise extraction',
  not_needed: 'Plus nécessaire',
  other: 'Autre',
}

export interface SiteDeadline {
  id: string
  site_id: string
  report_id: string | null
  title: string
  /** La contrainte DITE (« Avant le démarrage »). Jamais une date déduite. */
  constraint_text: string | null
  /** null = à planifier. */
  due_date: string | null
  status: DeadlineStatus
  created_at: string
  /** Date du PV source si l'échéance vient d'un import historique. Null = saisie manuelle. */
  source_document_effective_date: string | null
  /** FK vers canonical_subject (mig 346). Null = sujet non identifié. */
  canonical_subject_id: string | null
}

/** Une échéance sortie du planning actif (réalisée / annulée / remplacée) — pour
 *  l'historique et la traçabilité. Porte le QUI/QUAND/POURQUOI de sa fin de vie. */
export interface SiteDeadlineHistory extends SiteDeadline {
  completed_at: string | null
  completed_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancel_reason: DeadlineCancelReason | null
  cancel_comment: string | null
  superseded_by: string | null
  /** Résolu : nom de l'acteur (réalisateur ou annuleur). */
  actor_name: string | null
  /** Résolu : titre de l'échéance de remplacement (statut superseded). */
  replacement_title: string | null
  replacement_due_date: string | null
}

export async function createSiteDeadline(input: {
  site_id: string
  report_id?: string | null
  organization_id?: string | null
  title: string
  constraint_text?: string | null
  due_date?: string | null
  created_by?: string | null
  created_from?: string | null
  /** Clé d'idempotence Copilote (P4-E2) — même mécanique que site_watchpoints.copilot_proposal_id, mig 332. */
  copilot_proposal_id?: string | null
}): Promise<string> {
  // La date décide de l'état : datée → elle vit dans le planning ; sinon elle
  // attend une décision. Aucun autre chemin — l'état ne se contredit pas avec la donnée.
  const status: DeadlineStatus = input.due_date ? 'planned' : 'to_plan'
  const { data, error } = await createAdminClient()
    .from('site_deadlines')
    .insert({
      site_id: input.site_id,
      report_id: input.report_id ?? null,
      organization_id: input.organization_id ?? null,
      title: input.title,
      constraint_text: input.constraint_text?.trim() || null,
      due_date: input.due_date ?? null,
      status,
      created_by: input.created_by ?? null,
      created_from: input.created_from ?? 'manual',
      copilot_proposal_id: input.copilot_proposal_id ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  invalidateSiteProjection(input.site_id)
  return (data as { id: string }).id
}

/**
 * Les échéances vivantes d'un chantier : à planifier + planifiées.
 *
 * Par défaut, les échéances `created_from='historical_import'` sont exclues :
 * elles constituent la mémoire historique du chantier mais ne sont pas des
 * engagements opérationnels actifs. Passer `includeHistorical: true` pour les
 * surfaces qui ont besoin de l'historique complet (lignes de vie, mémoire).
 */
export async function listSiteDeadlines(
  siteId: string,
  { includeHistorical = false }: { includeHistorical?: boolean } = {},
): Promise<SiteDeadline[]> {
  let query = createAdminClient()
    .from('site_deadlines')
    .select('id, site_id, report_id, title, constraint_text, due_date, status, created_at, source_document_effective_date, canonical_subject_id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .in('status', ['to_plan', 'planned'])
  if (!includeHistorical) {
    query = query.neq('created_from', 'historical_import')
  }
  const { data, error } = await query
    // Les non datées en dernier : `nullsFirst: false` — « à planifier » n'est pas
    // « urgent », c'est « pas encore décidé ».
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) return []
  return (data ?? []) as SiteDeadline[]
}

/** Datée par un humain : l'échéance quitte « à planifier » pour le planning.
 *  Sert aussi à REPLANIFIER une échéance déjà datée (nouvelle date, statut actif). */
export async function planSiteDeadline(id: string, dueDate: string): Promise<string | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('site_deadlines')
    .update({ due_date: dueDate, status: 'planned', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('site_id')
    .maybeSingle()
  if (error) throw error
  const siteId = (data as { site_id: string } | null)?.site_id ?? null
  if (siteId) invalidateSiteProjection(siteId)
  return siteId
}

/** L'échéance est arrivée : réalisée. Sort du planning actif, reste dans l'historique. */
export async function completeSiteDeadline(id: string, userId: string | null): Promise<string | null> {
  const db = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('site_deadlines')
    .update({ status: 'done', completed_at: now, completed_by: userId, updated_at: now })
    .eq('id', id)
    .select('site_id')
    .maybeSingle()
  if (error) throw error
  const siteId = (data as { site_id: string } | null)?.site_id ?? null
  if (siteId) invalidateSiteProjection(siteId)
  return siteId
}

/**
 * Fin de vie d'une échéance VALIDÉE : annulée (sans objet) ou remplacée. On exige
 * un motif ; la date/l'auteur/le commentaire/le remplaçant sont mémorisés (jamais
 * un simple effacement). Une échéance remplaçante → statut 'superseded' + lien.
 */
export async function cancelSiteDeadline(
  id: string,
  input: { reason: DeadlineCancelReason; comment?: string | null; replacementId?: string | null },
  userId: string | null,
): Promise<{ siteId: string | null; title: string | null }> {
  const db = createAdminClient()
  const now = new Date().toISOString()
  const replacement = input.replacementId?.trim() || null
  const { data, error } = await db
    .from('site_deadlines')
    .update({
      status: replacement ? 'superseded' : 'cancelled',
      cancelled_at: now,
      cancelled_by: userId,
      cancel_reason: input.reason,
      cancel_comment: input.comment?.trim() || null,
      superseded_by: replacement,
      updated_at: now,
    })
    .eq('id', id)
    .select('site_id, title')
    .maybeSingle()
  if (error) throw error
  const row = data as { site_id: string; title: string } | null
  if (row?.site_id) invalidateSiteProjection(row.site_id)
  return { siteId: row?.site_id ?? null, title: row?.title ?? null }
}

/** Rouvre une échéance réalisée par erreur (undo) : la remet dans le planning actif.
 *  Restaure `to_plan` ou `planned` selon la présence de `due_date`. */
export async function reopenSiteDeadline(id: string): Promise<string | null> {
  const db = createAdminClient()
  const { data: cur } = await db.from('site_deadlines').select('due_date, site_id').eq('id', id).maybeSingle()
  const row = cur as { due_date: string | null; site_id: string } | null
  if (!row) return null
  const status: DeadlineStatus = row.due_date ? 'planned' : 'to_plan'
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('site_deadlines')
    .update({ status, completed_at: null, completed_by: null, updated_at: now })
    .eq('id', id)
    .select('site_id')
    .maybeSingle()
  if (error) throw error
  const siteId = (data as { site_id: string } | null)?.site_id ?? row.site_id
  if (siteId) invalidateSiteProjection(siteId)
  return siteId
}

/** L'organisation propriétaire d'une échéance (via son chantier) — garde tenant
 *  des actions serveur : on ne mute jamais une échéance hors de son organisation. */
export async function getSiteDeadlineOrgId(id: string): Promise<string | null> {
  const db = createAdminClient()
  const { data: d } = await db.from('site_deadlines').select('site_id').eq('id', id).maybeSingle()
  const siteId = (d as { site_id: string } | null)?.site_id
  if (!siteId) return null
  const { data: s } = await db.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
  return (s as { organization_id: string | null } | null)?.organization_id ?? null
}

/** Historique des échéances (hors planning actif) : réalisées / annulées /
 *  remplacées, les plus récentes d'abord. Résout les noms d'acteurs et les titres
 *  de remplacement en une passe batch (pas de N+1). */
export async function listSiteDeadlineHistory(siteId: string): Promise<SiteDeadlineHistory[]> {
  const db = createAdminClient()
  type RawRow = {
    id: string; site_id: string; report_id: string | null; title: string
    constraint_text: string | null; due_date: string | null; status: DeadlineStatus
    created_at: string; source_document_effective_date: string | null
    canonical_subject_id: string | null
    completed_at: string | null; completed_by: string | null
    cancelled_at: string | null; cancelled_by: string | null
    cancel_reason: DeadlineCancelReason | null; cancel_comment: string | null
    superseded_by: string | null
  }
  const { data, error } = await db
    .from('site_deadlines')
    .select('id, site_id, report_id, title, constraint_text, due_date, status, created_at, source_document_effective_date, canonical_subject_id, completed_at, completed_by, cancelled_at, cancelled_by, cancel_reason, cancel_comment, superseded_by')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .in('status', ['done', 'cancelled', 'superseded'])
    .order('updated_at', { ascending: false })
  if (error) return []
  const rows = (data ?? []) as RawRow[]
  if (rows.length === 0) return []

  // Batch : noms d'acteurs + titres de remplacement.
  const actorIds = [...new Set(rows.flatMap((r) => [r.completed_by, r.cancelled_by]).filter((v): v is string => !!v))]
  const replacementIds = [...new Set(rows.map((r) => r.superseded_by).filter((v): v is string => !!v))]

  const actorMap = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: users } = await db.from('users').select('id, full_name').in('id', actorIds)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (u.full_name?.trim()) actorMap.set(u.id, u.full_name.trim())
    }
  }

  const replacementMap = new Map<string, { title: string; due_date: string | null }>()
  if (replacementIds.length > 0) {
    const { data: repl } = await db.from('site_deadlines').select('id, title, due_date').in('id', replacementIds)
    for (const r of (repl ?? []) as Array<{ id: string; title: string; due_date: string | null }>) {
      replacementMap.set(r.id, { title: r.title, due_date: r.due_date })
    }
  }

  return rows.map((r) => ({
    ...r,
    actor_name: (r.cancelled_by && actorMap.get(r.cancelled_by)) || (r.completed_by && actorMap.get(r.completed_by)) || null,
    replacement_title: r.superseded_by ? (replacementMap.get(r.superseded_by)?.title ?? null) : null,
    replacement_due_date: r.superseded_by ? (replacementMap.get(r.superseded_by)?.due_date ?? null) : null,
  }))
}
