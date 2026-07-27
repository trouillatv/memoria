import 'server-only'

// ── CONTEXTE OPÉRATIONNEL D'UN ACTEUR (V2.2) ─────────────────────────────────
// Répond à « pourquoi est-ce que je connais cette personne (ou entreprise) ? » via
// ses DERNIÈRES INTERACTIONS DATÉES — le dernier ÉVÉNEMENT de chaque type, pas un
// compteur (« mentionné 14 fois » n'apprend rien ; « vu le 24 juillet » si).
//
// On ne montre QUE des événements STRUCTURELS et datés (FK) : actions
// (référent/responsable), décisions (personne décisionnaire), ajout au casting
// d'un chantier, ajout à une équipe, et le CR/visite/réunion d'où l'acteur a été
// rattaché (`site_intervenants.source_report_id`). On EXCLUT le flou : participants
// JSONB rattachés par nom, décisionnaire en texte libre — jamais de « présent à la
// visite » qu'on ne peut pas prouver.

import { createAdminClient } from '@/lib/supabase/admin'

export type ActorContextEventKind = 'report' | 'decision' | 'action' | 'casting' | 'team'

export interface ActorContextEvent {
  kind: ActorContextEventKind
  /** Jour ISO (YYYY-MM-DD). */
  date: string
  label: string
  sub: string | null
  href: string | null
}

export interface ActorContext {
  /** Le DERNIER événement de chaque type présent (ordre de lecture fixe). */
  latest: ActorContextEvent[]
  /** Frise condensée : tous les événements datés, du plus récent, plafonnés. */
  timeline: ActorContextEvent[]
}

// Ordre de lecture des « dernières interactions » (mockup Vincent : CR, décision,
// action, puis rattachements).
const LATEST_ORDER: ActorContextEventKind[] = ['report', 'decision', 'action', 'casting', 'team']
const TIMELINE_MAX = 6

const day = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null)

/** Compose le contexte à partir d'événements déjà datés (PUR, testable). Trie la
 *  frise du plus récent, garde le dernier de chaque type pour « dernières
 *  interactions ». Aucune invention, aucun compteur. */
export function buildActorContext(events: ActorContextEvent[]): ActorContext {
  const sorted = [...events].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const latest: ActorContextEvent[] = []
  for (const kind of LATEST_ORDER) {
    const first = sorted.find((e) => e.kind === kind)
    if (first) latest.push(first)
  }
  return { latest, timeline: sorted.slice(0, TIMELINE_MAX) }
}

/** Contexte opérationnel d'une personne (`company_contacts`) ou d'une entreprise
 *  (`companies`). Garde org fail-closed : on ne lit un acteur (et donc ses
 *  événements) que s'il appartient à l'organisation. */
export async function getActorContext(kind: 'person' | 'company', id: string, orgIds: string[]): Promise<ActorContext> {
  const empty: ActorContext = { latest: [], timeline: [] }
  if (orgIds.length === 0) return empty
  const db = createAdminClient()

  // Garde : l'acteur doit appartenir à l'org (sinon on ne lit rien de ses events).
  const table = kind === 'person' ? 'company_contacts' : 'companies'
  const { data: owner } = await db.from(table).select('id').eq('id', id).in('organization_id', orgIds).is('deleted_at', null).maybeSingle()
  if (!owner) return empty

  const events: ActorContextEvent[] = []
  const siteIdsNeeded = new Set<string>()
  const reportIdsNeeded = new Set<string>()

  // ── Actions (référent = personne ; responsable = entreprise) ──
  const actionCol = kind === 'person' ? 'assigned_contact_id' : 'assigned_company_id'
  const { data: actions } = await db
    .from('site_actions')
    .select('id, title, created_at, site_id')
    .eq(actionCol, id)
    .order('created_at', { ascending: false })
    .limit(TIMELINE_MAX)
  for (const a of (actions ?? []) as Array<{ id: string; title: string; created_at: string; site_id: string }>) {
    const d = day(a.created_at); if (!d) continue
    siteIdsNeeded.add(a.site_id)
    events.push({ kind: 'action', date: d, label: a.title, sub: a.site_id, href: `/sites/${a.site_id}` })
  }

  // ── Casting (ajout au chantier) + CR source (rattachement fiable à un rapport) ──
  const castingCol = kind === 'person' ? 'main_contact_id' : 'company_id'
  const { data: castings } = await db
    .from('site_intervenants')
    .select('id, role, effective_from, source_report_id, site_id')
    .eq(castingCol, id)
    .order('effective_from', { ascending: false })
  for (const c of (castings ?? []) as Array<{ id: string; role: string; effective_from: string | null; source_report_id: string | null; site_id: string }>) {
    const d = day(c.effective_from)
    if (d) { siteIdsNeeded.add(c.site_id); events.push({ kind: 'casting', date: d, label: `Ajouté au casting (${c.role})`, sub: c.site_id, href: `/sites/${c.site_id}` }) }
    if (c.source_report_id) reportIdsNeeded.add(c.source_report_id)
  }

  // ── Décisions (personne décisionnaire uniquement — pas de FK entreprise) ──
  if (kind === 'person') {
    const { data: decisions } = await db
      .from('site_decisions')
      .select('id, titre, date_decision, created_at, site_id')
      .eq('decisionnaire_contact_id', id)
      .order('date_decision', { ascending: false })
      .limit(TIMELINE_MAX)
    for (const dec of (decisions ?? []) as Array<{ id: string; titre: string; date_decision: string | null; created_at: string; site_id: string }>) {
      const d = day(dec.date_decision ?? dec.created_at); if (!d) continue
      siteIdsNeeded.add(dec.site_id)
      events.push({ kind: 'decision', date: d, label: dec.titre, sub: dec.site_id, href: `/sites/${dec.site_id}` })
    }

    // ── Équipe (ajout à une équipe) ──
    const { data: teamRows } = await db
      .from('team_field_members')
      .select('team_id, joined_at')
      .eq('contact_id', id)
      .order('joined_at', { ascending: false })
    const teamIds = [...new Set(((teamRows ?? []) as Array<{ team_id: string }>).map((t) => t.team_id))]
    const teamName = new Map<string, string>()
    if (teamIds.length) {
      const { data: teams } = await db.from('teams').select('id, name').in('id', teamIds)
      for (const t of (teams ?? []) as Array<{ id: string; name: string }>) teamName.set(t.id, t.name)
    }
    for (const t of (teamRows ?? []) as Array<{ team_id: string; joined_at: string | null }>) {
      const d = day(t.joined_at); if (!d) continue
      events.push({ kind: 'team', date: d, label: `Ajouté à l’équipe ${teamName.get(t.team_id) ?? ''}`.trim(), sub: null, href: `/equipes/${t.team_id}` })
    }
  }

  // ── CR / visites / réunions rattachés (via le source_report_id du casting) ──
  if (reportIdsNeeded.size) {
    const { data: reports } = await db
      .from('site_reports')
      .select('id, started_at, created_at, origin, site_id')
      .in('id', [...reportIdsNeeded])
    for (const r of (reports ?? []) as Array<{ id: string; started_at: string | null; created_at: string; origin: string | null; site_id: string }>) {
      const d = day(r.started_at ?? r.created_at); if (!d) continue
      siteIdsNeeded.add(r.site_id)
      // origin renseigné = visite terrain ; null = réunion (mig 162).
      events.push({ kind: 'report', date: d, label: r.origin ? 'Cité dans une visite' : 'Cité dans une réunion', sub: r.site_id, href: `/sites/${r.site_id}/visites/${r.id}` })
    }
  }

  // Résolution des noms de chantier (les `sub` portent l'id de site jusqu'ici).
  if (siteIdsNeeded.size) {
    const { data: sites } = await db.from('sites').select('id, name').in('id', [...siteIdsNeeded])
    const siteName = new Map(((sites ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
    for (const e of events) if (e.sub && siteName.has(e.sub)) e.sub = siteName.get(e.sub)!
  }

  return buildActorContext(events)
}
