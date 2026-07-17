import 'server-only'

// ── LE MOMENT PRÉVU ──────────────────────────────────────────────────────────
// « Que va-t-il se passer sur ce chantier ? » — la question à laquelle le
// Planning ne savait pas répondre, parce que le futur n'était qu'une colonne
// (`next_meeting_at`) ou rien du tout (la visite prévue n'existait pas).
//
// LA FRONTIÈRE : cette table ne porte QUE les événements futurs SANS objet métier
// spécialisé. Une intervention a déjà son cycle (équipe, horaires, preuves,
// facturation) ; une échéance, une fermeture, un roulement, un blocage aussi. Ils
// sont PROJETÉS dans le Planning, jamais migrés ici. Sans cette règle, cet objet
// redevient le fourre-tout qu'on cherche à éviter.
//
// LE WORKFLOW N'EST PAS COMMUN. Le cycle (planned → in_progress → completed) l'est ;
// ce que le démarrage PRODUIT ne l'est pas. La règle n'est pas « tout événement
// crée un report » mais « certains types peuvent en produire un, selon leur
// workflow ». Une livraison se constate, elle ne se raconte pas.

import { createAdminClient } from '@/lib/supabase/admin'
import { createVisit } from '@/lib/db/visits'
import { createSiteReport } from '@/lib/db/site-reports'

export type ScheduledEventType = 'visit' | 'meeting' | 'inspection' | 'delivery' | 'other'

export type ScheduledEventStatus = 'planned' | 'postponed' | 'in_progress' | 'completed' | 'cancelled'

/**
 * Le payload est DISCRIMINÉ par le type. La base le stocke en jsonb, mais elle ne
 * peut pas garantir sa forme : c'est ici que le contrat existe. Un jsonb libre
 * deviendrait une poubelle où chaque écran inventerait sa clé, et personne ne
 * saurait plus ce qu'un « moment prévu » contient.
 */
export type ScheduledEventPayload =
  | { type: 'visit'; objective?: string }
  | { type: 'meeting'; agenda?: string; participantIds?: string[] }
  | { type: 'inspection'; scope?: string }
  | { type: 'delivery'; supplier?: string; expectedItems?: string[] }
  | { type: 'other'; details?: string }

/** Un moment prévu, tel que les surfaces le lisent. */
export interface ScheduledEvent {
  id: string
  siteId: string
  type: ScheduledEventType
  status: ScheduledEventStatus
  plannedStart: string
  plannedEnd: string | null
  title: string | null
  payload: ScheduledEventPayload
  linkedReportId: string | null
  createdFrom: 'manual' | 'report_next_meeting' | 'recurrence' | null
}

/**
 * Ce qu'un type PRODUIT en démarrant. La règle vit ICI, une seule fois : sinon
 * chaque écran la redevinerait, et un jour l'un d'eux créerait un CR de livraison.
 *
 * - visite / contrôle : un site_report avec `origin` — c'est une visite terrain.
 * - réunion : un site_report SANS `origin` — le marqueur réunion est l'ABSENCE
 *   d'origin (cf. mig 162). Marqueur par absence, hérité : on s'y conforme.
 * - livraison / autre : rien. Une livraison se constate (`completed`), avec une
 *   preuve ou un commentaire. Lui fabriquer un compte-rendu serait inventer une
 *   visite que personne n'a faite.
 */
export function producesReport(type: ScheduledEventType): boolean {
  return type === 'visit' || type === 'meeting' || type === 'inspection'
}

/** L'`origin` du report produit — `null` pour une réunion (marqueur par absence). */
export function reportOriginFor(type: ScheduledEventType): 'planned' | null {
  return type === 'meeting' ? null : 'planned'
}

/**
 * Le payload, ramené de force à la forme du type. Une clé inconnue est JETÉE :
 * un jsonb écrit par une version précédente ne doit pas ressurgir dans une
 * surface qui ne l'attend pas. On ne devine rien — l'absence reste l'absence.
 */
export function parsePayload(type: ScheduledEventType, raw: unknown): ScheduledEventPayload {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const strList = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const out = v.filter((i): i is string => typeof i === 'string' && !!i.trim())
    return out.length > 0 ? out : undefined
  }
  switch (type) {
    case 'visit': return { type, objective: str(p.objective) }
    case 'meeting': return { type, agenda: str(p.agenda), participantIds: strList(p.participantIds) }
    case 'inspection': return { type, scope: str(p.scope) }
    case 'delivery': return { type, supplier: str(p.supplier), expectedItems: strList(p.expectedItems) }
    case 'other': return { type, details: str(p.details) }
  }
}

/** Le mot du conducteur pour un type. Jamais 'visit', jamais un type de table. */
export function scheduledTypeLabel(type: ScheduledEventType): string {
  switch (type) {
    case 'visit': return 'Visite'
    case 'meeting': return 'Réunion'
    case 'inspection': return 'Contrôle'
    case 'delivery': return 'Livraison'
    case 'other': return 'Rendez-vous'
  }
}

interface ScheduledEventRow {
  id: string
  site_id: string
  type: ScheduledEventType
  status: ScheduledEventStatus
  planned_start: string
  planned_end: string | null
  title: string | null
  payload: unknown
  linked_report_id: string | null
  created_from: ScheduledEvent['createdFrom']
}

function toScheduledEvent(r: ScheduledEventRow): ScheduledEvent {
  return {
    id: r.id,
    siteId: r.site_id,
    type: r.type,
    status: r.status,
    plannedStart: r.planned_start,
    plannedEnd: r.planned_end,
    title: r.title,
    payload: parsePayload(r.type, r.payload),
    linkedReportId: r.linked_report_id,
    createdFrom: r.created_from,
  }
}

/** Un moment prévu, ou la raison pour laquelle le geste n'a pas pu se faire. */
export type ScheduledResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** La garde fail-closed : le service-role bypasse la RLS, l'org se filtre ICI. */
async function loadOwned(id: string, orgId: string | null): Promise<ScheduledEventRow | null> {
  const db = createAdminClient()
  const { data } = await db
    .from('site_scheduled_events')
    .select('id, site_id, organization_id, type, status, planned_start, planned_end, title, payload, linked_report_id, created_from')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  const row = data as (ScheduledEventRow & { organization_id: string }) | null
  if (!row) return null
  if (orgId && row.organization_id && row.organization_id !== orgId) return null
  return row
}

/**
 * La trace d'un geste sur un rendez-vous. Un report n'est pas un changement de
 * date opaque : « reporté trois fois » raconte quelque chose que la nouvelle date
 * seule efface. Le Planning montre la date ; la frise pourra raconter le report.
 * On réutilise `activity_logs` (mig 009) — pas de table d'audit parallèle.
 */
async function trace(
  eventId: string,
  action: string,
  userId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const db = createAdminClient()
  await db.from('activity_logs').insert({
    entity_type: 'site_scheduled_event',
    entity_id: eventId,
    action,
    user_id: userId,
    metadata,
  })
}

export interface CreateScheduledEventInput {
  siteId: string
  type: ScheduledEventType
  plannedStart: string
  plannedEnd?: string | null
  title?: string | null
  payload?: unknown
  createdBy: string | null
  createdFrom?: ScheduledEvent['createdFrom']
  sourceReportId?: string | null
}

/**
 * Prévoir un moment. Le statut n'est JAMAIS fourni par l'appelant : un rendez-vous
 * naît `planned`, sinon un client pourrait faire naître une visite « terminée »
 * qui n'a jamais eu lieu.
 */
export async function createScheduledEvent(
  input: CreateScheduledEventInput,
): Promise<ScheduledResult<string>> {
  const start = Date.parse(input.plannedStart)
  if (!Number.isFinite(start)) return { ok: false, error: 'Date de début invalide' }
  if (input.plannedEnd) {
    const end = Date.parse(input.plannedEnd)
    if (!Number.isFinite(end)) return { ok: false, error: 'Date de fin invalide' }
    // Une fin avant le début n'est pas un rendez-vous, c'est une faute de saisie.
    if (end < start) return { ok: false, error: 'La fin ne peut pas précéder le début' }
  }

  const db = createAdminClient()
  const { data: site } = await db
    .from('sites')
    .select('id, organization_id')
    .eq('id', input.siteId)
    .is('deleted_at', null)
    .maybeSingle()
  const org = (site as { organization_id: string } | null)?.organization_id
  if (!org) return { ok: false, error: 'Chantier introuvable' }

  const { data, error } = await db
    .from('site_scheduled_events')
    .insert({
      organization_id: org,
      site_id: input.siteId,
      type: input.type,
      status: 'planned', // imposé, jamais reçu du client
      planned_start: input.plannedStart,
      planned_end: input.plannedEnd ?? null,
      title: input.title?.trim() || null,
      payload: parsePayload(input.type, input.payload),
      created_from: input.createdFrom ?? 'manual',
      source_report_id: input.sourceReportId ?? null,
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: 'Impossible de créer ce rendez-vous' }
  return { ok: true, value: (data as { id: string }).id }
}

/** Corriger un rendez-vous encore à venir. Ne touche jamais au statut. */
export async function updateScheduledEvent(
  id: string,
  patch: { plannedStart?: string; plannedEnd?: string | null; title?: string | null; payload?: unknown },
  ctx: { userId: string | null; orgId: string | null },
): Promise<ScheduledResult<null>> {
  const ev = await loadOwned(id, ctx.orgId)
  if (!ev) return { ok: false, error: 'Rendez-vous introuvable' }
  // Un moment déjà démarré ou tenu ne se réécrit pas : son histoire est faite.
  if (ev.status !== 'planned' && ev.status !== 'postponed') {
    return { ok: false, error: 'Ce rendez-vous a déjà commencé' }
  }
  const start = patch.plannedStart ?? ev.planned_start
  const end = patch.plannedEnd === undefined ? ev.planned_end : patch.plannedEnd
  if (end && Date.parse(end) < Date.parse(start)) {
    return { ok: false, error: 'La fin ne peut pas précéder le début' }
  }

  const db = createAdminClient()
  const { error } = await db
    .from('site_scheduled_events')
    .update({
      planned_start: start,
      planned_end: end,
      ...(patch.title !== undefined ? { title: patch.title?.trim() || null } : {}),
      ...(patch.payload !== undefined ? { payload: parsePayload(ev.type, patch.payload) } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { ok: false, error: 'Modification impossible' }
  return { ok: true, value: null }
}

/**
 * Reporter. Distinct d'annuler : un chantier reporté trois fois raconte quelque
 * chose qu'une annulation effacerait. L'ancienne date survit dans la trace.
 */
export async function postponeScheduledEvent(
  id: string,
  newStart: string,
  ctx: { userId: string | null; orgId: string | null; reason?: string | null; newEnd?: string | null },
): Promise<ScheduledResult<null>> {
  if (!Number.isFinite(Date.parse(newStart))) return { ok: false, error: 'Nouvelle date invalide' }
  const ev = await loadOwned(id, ctx.orgId)
  if (!ev) return { ok: false, error: 'Rendez-vous introuvable' }
  if (ev.status !== 'planned' && ev.status !== 'postponed') {
    return { ok: false, error: 'Seul un rendez-vous à venir peut être reporté' }
  }

  const db = createAdminClient()
  const { error } = await db
    .from('site_scheduled_events')
    .update({
      planned_start: newStart,
      planned_end: ctx.newEnd ?? null,
      status: 'postponed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { ok: false, error: 'Report impossible' }
  await trace(id, 'postponed', ctx.userId, {
    from: ev.planned_start,
    to: newStart,
    reason: ctx.reason?.trim() || null,
  })
  return { ok: true, value: null }
}

/** Annuler. Le rendez-vous reste : « on ne s'est pas vu » est un fait du chantier. */
export async function cancelScheduledEvent(
  id: string,
  ctx: { userId: string | null; orgId: string | null; reason?: string | null },
): Promise<ScheduledResult<null>> {
  const ev = await loadOwned(id, ctx.orgId)
  if (!ev) return { ok: false, error: 'Rendez-vous introuvable' }
  if (ev.status === 'completed') return { ok: false, error: 'Ce rendez-vous a déjà eu lieu' }
  if (ev.status === 'cancelled') return { ok: true, value: null } // idempotent

  const db = createAdminClient()
  const { error } = await db
    .from('site_scheduled_events')
    .update({ status: 'cancelled', cancel_reason: ctx.reason?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, error: 'Annulation impossible' }
  await trace(id, 'cancelled', ctx.userId, { reason: ctx.reason?.trim() || null })
  return { ok: true, value: null }
}

/**
 * Démarrer — le seul geste qui fait NAÎTRE le passé du futur.
 *
 * IDEMPOTENCE, non négociable : deux clics ne doivent jamais créer deux
 * comptes-rendus. La garde n'est pas un `if` (deux requêtes concurrentes le
 * passeraient toutes les deux) mais un UPDATE CONDITIONNEL : le premier à poser
 * `linked_report_id` gagne, le second voit 0 ligne modifiée et récupère le CR du
 * gagnant. Le report perdant est supprimé — il n'a rien capturé, il n'a pas
 * d'histoire à perdre.
 */
export async function startScheduledEvent(
  id: string,
  ctx: { userId: string | null; orgId: string | null },
): Promise<ScheduledResult<{ reportId: string | null }>> {
  const ev = await loadOwned(id, ctx.orgId)
  if (!ev) return { ok: false, error: 'Rendez-vous introuvable' }
  if (ev.status === 'cancelled') return { ok: false, error: 'Ce rendez-vous a été annulé' }
  // Déjà démarré : on rend le CR existant, on n'en crée pas un second.
  if (ev.linked_report_id) return { ok: true, value: { reportId: ev.linked_report_id } }
  if (ev.status === 'completed') return { ok: true, value: { reportId: null } }

  const db = createAdminClient()

  // Une livraison n'a pas de compte-rendu : elle se constate, elle ne se raconte pas.
  if (!producesReport(ev.type)) {
    const { error } = await db
      .from('site_scheduled_events')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', ev.status)
    if (error) return { ok: false, error: 'Démarrage impossible' }
    await trace(id, 'started', ctx.userId, { type: ev.type, report: false })
    return { ok: true, value: { reportId: null } }
  }

  const reportId = await createReportFor(ev, ctx.userId)
  if (!reportId) return { ok: false, error: 'Impossible de créer le compte-rendu' }

  const { data: won } = await db
    .from('site_scheduled_events')
    .update({ status: 'in_progress', linked_report_id: reportId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .is('linked_report_id', null) // ← la course se tranche ici
    .select('id')
    .maybeSingle()

  if (!won) {
    // Quelqu'un a démarré pendant qu'on créait : on jette NOTRE report (vide) et
    // on rend le sien. Jamais deux CR pour une réunion.
    await db.from('site_reports').delete().eq('id', reportId)
    const again = await loadOwned(id, ctx.orgId)
    return again?.linked_report_id
      ? { ok: true, value: { reportId: again.linked_report_id } }
      : { ok: false, error: 'Démarrage impossible' }
  }
  await trace(id, 'started', ctx.userId, { type: ev.type, report_id: reportId })
  return { ok: true, value: { reportId } }
}

/** Le CR que produit un type. La règle vit dans producesReport/reportOriginFor. */
async function createReportFor(ev: ScheduledEventRow, userId: string | null): Promise<string | null> {
  const origin = reportOriginFor(ev.type)
  try {
    if (origin === null) {
      // RÉUNION : le marqueur est l'ABSENCE d'origin (mig 162). createSiteReport
      // ne pose pas origin — c'est LUI le créateur de réunion, et on n'en écrit
      // pas un second.
      const db = createAdminClient()
      const { data: site } = await db.from('sites').select('tenant_id').eq('id', ev.site_id).maybeSingle()
      const tenantId = (site as { tenant_id: string } | null)?.tenant_id
      if (!tenantId) return null
      return await createSiteReport({
        site_id: ev.site_id,
        tenant_id: tenantId,
        title: ev.title,
        created_by: userId,
      })
    }
    return await createVisit({ siteId: ev.site_id, origin, createdBy: userId })
  } catch {
    return null
  }
}

/**
 * Terminer. Ne crée JAMAIS un compte-rendu rétroactivement : un moment qui se
 * termine sans être passé par « démarrer » n'a produit aucune trace, et lui en
 * fabriquer une inventerait une visite que personne n'a faite.
 */
export async function completeScheduledEvent(
  id: string,
  ctx: { userId: string | null; orgId: string | null; note?: string | null },
): Promise<ScheduledResult<null>> {
  const ev = await loadOwned(id, ctx.orgId)
  if (!ev) return { ok: false, error: 'Rendez-vous introuvable' }
  if (ev.status === 'completed') return { ok: true, value: null } // idempotent
  if (ev.status === 'cancelled') return { ok: false, error: 'Ce rendez-vous a été annulé' }
  // La base l'interdirait de toute façon (sse_report_required_when_started) ; on
  // le dit ici avec les mots du conducteur plutôt qu'avec une erreur SQL.
  if (producesReport(ev.type) && !ev.linked_report_id) {
    return { ok: false, error: "Démarrez-le d'abord : sans compte-rendu, il n'aurait laissé aucune trace" }
  }

  const db = createAdminClient()
  const { error } = await db
    .from('site_scheduled_events')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, error: 'Clôture impossible' }
  await trace(id, 'completed', ctx.userId, { note: ctx.note?.trim() || null })
  return { ok: true, value: null }
}

/** Ce qui est prévu sur un chantier, du plus proche au plus lointain. */
export async function listScheduledEvents(
  siteId: string,
  opts: { from?: string; to?: string } = {},
): Promise<ScheduledEvent[]> {
  const db = createAdminClient()
  let q = db
    .from('site_scheduled_events')
    .select('id, site_id, type, status, planned_start, planned_end, title, payload, linked_report_id, created_from')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('planned_start', { ascending: true })
  if (opts.from) q = q.gte('planned_start', opts.from)
  if (opts.to) q = q.lte('planned_start', opts.to)
  const { data } = await q
  return ((data ?? []) as ScheduledEventRow[]).map(toScheduledEvent)
}
