// lib/db/site-timeline.ts
// Frise du chantier — « Raconte-moi l'histoire de ce chantier ».
//
// TROISIÈME lentille MOBILE sur les mêmes sources, dédiée à la fiche chantier :
// une chronologie PLATE, tri DÉCROISSANT, qui FUSIONNE tous les événements déjà
// existants (visites, réunions/CR, interventions faites, réserves ouvertes/levées,
// actions terminées, décisions). 100 % DÉTERMINISTE : on projette des objets
// réels, on ne résume RIEN, aucun LLM. Chaque événement porte un lien vers son
// objet quand une vue mobile existe (visite/réunion → récap, intervention →
// détail) ; sinon la carte est informative (réserve/action/décision n'ont pas
// encore d'écran mobile propre).

import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteReserves } from '@/lib/db/site-reserve'
import { listDecisionsBySite } from '@/lib/db/site-decisions'
import { visitIntentLabel } from '@/lib/field/visit-intents'

export type TimelineKind =
  | 'visit'
  | 'meeting'
  | 'intervention'
  | 'reserve_open'
  | 'reserve_lifted'
  | 'action_done'
  | 'decision'

export interface TimelineEvent {
  at: string // ISO — clé de tri (décroissant)
  dateLabel: string // « 12 juin 2026 » (civil Pacific/Noumea)
  kind: TimelineKind
  title: string
  detail: string | null
  href: string | null
}

const VISIT_TYPE_LABEL: Record<string, string> = {
  planned: 'Visite planifiée',
  spontaneous: 'Visite',
  qr: 'Visite',
  gps: 'Visite',
  import: 'Visite importée',
}

/** ISO → « 12 juin 2026 » (date civile, fuseau chantier). */
function frDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Noumea' })
}

/**
 * Construit la frise d'un chantier : tous les jalons réels, du plus récent au
 * plus ancien. `limit` borne l'affichage par récence (l'histoire récente d'abord).
 */
export async function buildSiteTimeline(siteId: string, limit = 100): Promise<TimelineEvent[]> {
  try {
    return await buildSiteTimelineInner(siteId, limit)
  } catch {
    // Une frise ne doit JAMAIS faire planter la page — au pire, elle est vide.
    return []
  }
}

async function buildSiteTimelineInner(siteId: string, limit: number): Promise<TimelineEvent[]> {
  const supabase = createAdminClient()

  const [repsRes, missionsRes, reserves, decisions, actionsRes] = await Promise.all([
    // Visites + réunions/CR (origin non-null = visite, null = réunion).
    supabase
      .from('site_reports')
      .select('id, title, origin, visit_motive, started_at, ended_at, created_at')
      .eq('site_id', siteId)
      .neq('status', 'draft'),
    supabase.from('missions').select('id, name').eq('site_id', siteId).is('deleted_at', null),
    getSiteReserves(siteId).catch(() => []),
    listDecisionsBySite(siteId).catch(() => []),
    // Actions terminées = fait accompli (jalon d'histoire).
    supabase.from('site_actions').select('id, title, done_at, created_at').eq('site_id', siteId).eq('status', 'done'),
  ])

  const events: TimelineEvent[] = []

  // Visites & réunions.
  for (const r of (repsRes.data ?? []) as Array<{ id: string; title: string | null; origin: string | null; visit_motive: string | null; started_at: string | null; ended_at: string | null; created_at: string }>) {
    const at = r.ended_at ?? r.started_at ?? r.created_at
    if (r.origin) {
      // La frise raconte une HISTOIRE : la visite porte son intention (Première
      // visite / Prévisite AO / Suivi) plutôt qu'un générique « Visite ».
      events.push({
        at,
        dateLabel: frDate(at),
        kind: 'visit',
        title: visitIntentLabel(r.visit_motive) ?? VISIT_TYPE_LABEL[r.origin] ?? 'Visite',
        detail: null,
        href: `/m/visite/${r.id}/recap`,
      })
    } else {
      events.push({
        at,
        dateLabel: frDate(at),
        kind: 'meeting',
        title: r.title?.trim() || 'Réunion',
        detail: null,
        href: `/m/visite/${r.id}/recap`,
      })
    }
  }

  // Interventions RÉALISÉES (completed/validated) — ce qui s'est réellement passé.
  const missionRows = (missionsRes.data ?? []) as Array<{ id: string; name: string }>
  if (missionRows.length > 0) {
    const missionName = new Map(missionRows.map((m) => [m.id, m.name]))
    const { data: intv } = await supabase
      .from('interventions')
      .select('id, mission_id, executed_at, scheduled_at, scheduled_for, status')
      .in('mission_id', missionRows.map((m) => m.id))
      .in('status', ['completed', 'validated'])
      .order('scheduled_at', { ascending: false })
      .limit(limit)
    for (const i of (intv ?? []) as Array<{ id: string; mission_id: string; executed_at: string | null; scheduled_at: string; scheduled_for: string | null; status: string }>) {
      const at = i.executed_at ?? (i.scheduled_for ? `${i.scheduled_for}T12:00:00Z` : i.scheduled_at)
      events.push({
        at,
        dateLabel: frDate(at),
        kind: 'intervention',
        title: missionName.get(i.mission_id) ?? 'Intervention',
        detail: null,
        href: `/m/intervention/${i.id}`,
      })
    }
  }

  // Réserves — ouverture + levée = deux jalons.
  for (const r of reserves) {
    const openIso = r.issuedOn ? `${r.issuedOn}T12:00:00Z` : r.createdAt
    events.push({
      at: openIso,
      dateLabel: frDate(openIso),
      kind: 'reserve_open',
      title: `Réserve : ${r.label}`,
      detail: r.location,
      href: null,
    })
    if (r.status === 'lifted' && r.liftedAt) {
      events.push({
        at: r.liftedAt,
        dateLabel: frDate(r.liftedAt),
        kind: 'reserve_lifted',
        title: `Réserve levée : ${r.label}`,
        detail: r.liftNote,
        href: null,
      })
    }
  }

  // Décisions.
  for (const d of decisions) {
    if (!d.dateDecision) continue
    const at = `${d.dateDecision}T12:00:00Z`
    events.push({
      at,
      dateLabel: frDate(at),
      kind: 'decision',
      title: d.titre || 'Décision',
      detail: d.description,
      href: null,
    })
  }

  // Actions terminées.
  for (const a of (actionsRes.data ?? []) as Array<{ id: string; title: string; done_at: string | null; created_at: string }>) {
    const at = a.done_at ?? a.created_at
    events.push({
      at,
      dateLabel: frDate(at),
      kind: 'action_done',
      title: `Action terminée : ${a.title}`,
      detail: null,
      href: null,
    })
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return events.slice(0, limit)
}
