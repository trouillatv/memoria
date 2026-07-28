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
}

/** Une échéance sortie du planning actif (réalisée / annulée / remplacée) — pour
 *  l'historique et la traçabilité. Porte le QUI/QUAND/POURQUOI de sa fin de vie. */
export interface SiteDeadlineHistory extends SiteDeadline {
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: DeadlineCancelReason | null
  cancel_comment: string | null
  superseded_by: string | null
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
    })
    .select('id')
    .single()
  if (error) throw error
  invalidateSiteProjection(input.site_id)
  return (data as { id: string }).id
}

/** Les échéances vivantes d'un chantier : à planifier + planifiées. */
export async function listSiteDeadlines(siteId: string): Promise<SiteDeadline[]> {
  const { data, error } = await createAdminClient()
    .from('site_deadlines')
    .select('id, site_id, report_id, title, constraint_text, due_date, status, created_at')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .in('status', ['to_plan', 'planned'])
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
): Promise<string | null> {
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
    .select('site_id')
    .maybeSingle()
  if (error) throw error
  const siteId = (data as { site_id: string } | null)?.site_id ?? null
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
 *  remplacées, les plus récentes d'abord. Pour la traçabilité et le bloc Pourquoi ?. */
export async function listSiteDeadlineHistory(siteId: string): Promise<SiteDeadlineHistory[]> {
  const { data, error } = await createAdminClient()
    .from('site_deadlines')
    .select('id, site_id, report_id, title, constraint_text, due_date, status, created_at, completed_at, cancelled_at, cancel_reason, cancel_comment, superseded_by')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .in('status', ['done', 'cancelled', 'superseded'])
    .order('updated_at', { ascending: false })
  if (error) return []
  return (data ?? []) as SiteDeadlineHistory[]
}
