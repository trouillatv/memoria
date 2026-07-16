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
