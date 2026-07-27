import 'server-only'

// ── GRAPHE DES ACTEURS (Lot 2B.4) ────────────────────────────────────────────
// Répond à « QUI travaille avec qui, où, et sur quoi ? » — liens ORGANISATIONNELS,
// jamais causaux (le graphe Mémoire, lui, répond à « pourquoi en est-on arrivé
// là ? »). Les deux partagent le moteur canvas mais racontent deux histoires
// distinctes : on ne les mélange JAMAIS.
//
// Uniquement des relations RÉELLES (FK), aucune inférence, aucune IA. Nœuds limités
// à 5 types (personne / entreprise / équipe / chantier / action ouverte) pour rester
// lisible. Couleur des nœuds = état d'attention COMMUN (politique partagée) → le
// graphe devient immédiatement un graphe d'ATTENTION, pas un simple schéma.
//
// buildActorsGraph est PUR (testable) ; getActorsGraph réutilise getActorsCockpit
// pour l'état d'attention (source unique) et ajoute la couche relationnelle.

import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { getActorsCockpit } from '@/lib/db/actors-cockpit'
import type { AttentionLevel } from '@/lib/knowledge/actor-attention'

export type ActorGraphKind = 'person' | 'company' | 'team' | 'site' | 'action'

export type ActorGraphRel =
  | 'belongs_to'      // personne → entreprise (appartient à)
  | 'member_of'       // personne → équipe (membre de)
  | 'mobilized_on'    // équipe → chantier (mobilisée sur)
  | 'intervenes_on'   // entreprise → chantier (intervient sur, casting actif)
  | 'referent_of'     // personne → action (référente de)
  | 'responsible_of'  // entreprise → action (responsable de)

export const REL_LABEL: Record<ActorGraphRel, string> = {
  belongs_to: 'appartient à',
  member_of: 'membre de',
  mobilized_on: 'mobilisée sur',
  intervenes_on: 'intervient sur',
  referent_of: 'référente de',
  responsible_of: 'responsable de',
}

export interface ActorGraphNode {
  id: string // préfixé par nature (p_/co_/tm_/s_/ac_) — jamais de collision entre types
  kind: ActorGraphKind
  label: string
  sub: string | null
  level: AttentionLevel   // couleur d'attention (partagée avec cockpit/fiches)
  historical: boolean     // rendu « gris » — existe encore mais hors périmètre actif
}

export interface ActorGraphEdge {
  a: string
  b: string
  rel: ActorGraphRel
  label: string
}

export interface ActorsGraph {
  nodes: ActorGraphNode[]
  edges: ActorGraphEdge[]
}

/** Acteur (personne/entreprise/équipe) déjà résolu par le cockpit (état d'attention inclus). */
export interface GraphActorInput {
  id: string
  name: string
  sub: string | null
  level: AttentionLevel
  historical: boolean
}

export interface ActorsGraphInputs {
  persons: Array<GraphActorInput & { companyId: string | null }>
  companies: GraphActorInput[]
  teams: GraphActorInput[]
  siteNames: Array<{ id: string; name: string }>
  fieldMemberships: Array<{ contactId: string; teamId: string }>  // personne → équipe (actif)
  missions: Array<{ siteId: string; teamId: string }>             // équipe → chantier (actif)
  casting: Array<{ companyId: string; siteId: string }>           // entreprise → chantier (casting actif)
  openActions: Array<{ id: string; title: string; siteId: string; contactId: string | null; companyId: string | null; overdue: boolean }>
}

const P = (id: string) => `p_${id}`
const CO = (id: string) => `co_${id}`
const TM = (id: string) => `tm_${id}`
const S = (id: string) => `s_${id}`
const AC = (id: string) => `ac_${id}`

/**
 * Compose le graphe organisationnel. Déterministe. N'inclut un chantier ou une action
 * QUE s'il est réellement relié à un acteur du périmètre (jamais de nœud orphelin).
 */
export function buildActorsGraph(input: ActorsGraphInputs): ActorsGraph {
  const personSet = new Set(input.persons.map((p) => p.id))
  const companySet = new Set(input.companies.map((c) => c.id))
  const teamSet = new Set(input.teams.map((t) => t.id))
  const siteNameById = new Map(input.siteNames.map((s) => [s.id, s.name]))

  const edges: ActorGraphEdge[] = []
  const edgeKeys = new Set<string>()
  const pushEdge = (a: string, b: string, rel: ActorGraphRel) => {
    const key = `${a}|${b}|${rel}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ a, b, rel, label: REL_LABEL[rel] })
  }

  // Chantiers & actions réellement reliés (calculés d'abord pour ne garder que l'utile).
  const siteHasOverdue = new Map<string, boolean>()
  const siteHasOpen = new Map<string, boolean>()
  const includedSites = new Set<string>()
  const includedActions: ActorsGraphInputs['openActions'] = []

  for (const a of input.openActions) {
    const hasPerson = a.contactId != null && personSet.has(a.contactId)
    const hasCompany = a.companyId != null && companySet.has(a.companyId)
    if (!hasPerson && !hasCompany) continue // action non reliée à un acteur du périmètre → ignorée
    includedActions.push(a)
    includedSites.add(a.siteId)
    siteHasOpen.set(a.siteId, true)
    if (a.overdue) siteHasOverdue.set(a.siteId, true)
  }
  for (const m of input.missions) if (teamSet.has(m.teamId)) includedSites.add(m.siteId)
  for (const c of input.casting) if (companySet.has(c.companyId)) includedSites.add(c.siteId)

  const nodes: ActorGraphNode[] = []
  for (const p of input.persons) nodes.push({ id: P(p.id), kind: 'person', label: p.name, sub: p.sub, level: p.level, historical: p.historical })
  for (const c of input.companies) nodes.push({ id: CO(c.id), kind: 'company', label: c.name, sub: c.sub, level: c.level, historical: c.historical })
  for (const t of input.teams) nodes.push({ id: TM(t.id), kind: 'team', label: t.name, sub: t.sub, level: t.level, historical: t.historical })
  for (const siteId of includedSites) {
    const level: AttentionLevel = siteHasOverdue.get(siteId) ? 'urgent' : siteHasOpen.get(siteId) ? 'attention' : 'ok'
    nodes.push({ id: S(siteId), kind: 'site', label: siteNameById.get(siteId) ?? 'Chantier', sub: null, level, historical: false })
  }
  for (const a of includedActions) {
    nodes.push({ id: AC(a.id), kind: 'action', label: a.title, sub: siteNameById.get(a.siteId) ?? null, level: a.overdue ? 'urgent' : 'ok', historical: false })
  }

  // Liens structurels (uniquement entre nœuds réellement présents).
  for (const p of input.persons) {
    if (p.companyId && companySet.has(p.companyId)) pushEdge(P(p.id), CO(p.companyId), 'belongs_to')
  }
  for (const f of input.fieldMemberships) {
    if (personSet.has(f.contactId) && teamSet.has(f.teamId)) pushEdge(P(f.contactId), TM(f.teamId), 'member_of')
  }
  for (const m of input.missions) {
    if (teamSet.has(m.teamId) && includedSites.has(m.siteId)) pushEdge(TM(m.teamId), S(m.siteId), 'mobilized_on')
  }
  for (const c of input.casting) {
    if (companySet.has(c.companyId) && includedSites.has(c.siteId)) pushEdge(CO(c.companyId), S(c.siteId), 'intervenes_on')
  }
  for (const a of includedActions) {
    if (a.contactId && personSet.has(a.contactId)) pushEdge(P(a.contactId), AC(a.id), 'referent_of')
    if (a.companyId && companySet.has(a.companyId)) pushEdge(CO(a.companyId), AC(a.id), 'responsible_of')
  }

  return { nodes, edges }
}

/**
 * Graphe des acteurs de l'organisation. Réutilise getActorsCockpit (état d'attention =
 * source unique) et ajoute la couche relationnelle par des lectures filtrées. Fail-closed :
 * sans org → graphe vide. Personnes = company_contacts (les comptes purs sont hors V1).
 */
export async function getActorsGraph(orgIds: string[]): Promise<ActorsGraph> {
  if (orgIds.length === 0) return { nodes: [], edges: [] }
  const db = createAdminClient()
  const today = todayLocalIso()

  const cockpit = await getActorsCockpit(orgIds)

  // Sites de l'org (pour filtrer les relations par site).
  const { data: siteRows } = await db.from('sites').select('id, name').in('organization_id', orgIds).is('deleted_at', null)
  const siteNames = ((siteRows ?? []) as Array<{ id: string; name: string }>)
  const siteIds = siteNames.map((s) => s.id)

  const [contactRes, tfmRes, missionRes, castingRes, actionRes] = await Promise.all([
    db.from('company_contacts').select('id, company_id').in('organization_id', orgIds).is('deleted_at', null),
    db.from('team_field_members').select('contact_id, team_id').is('left_at', null).in('organization_id', orgIds),
    siteIds.length ? db.from('missions').select('site_id, assigned_team_id').in('site_id', siteIds).is('deleted_at', null).not('assigned_team_id', 'is', null) : Promise.resolve({ data: [] }),
    siteIds.length ? db.from('site_intervenants').select('company_id, site_id').in('site_id', siteIds).is('effective_to', null) : Promise.resolve({ data: [] }),
    siteIds.length ? db.from('site_actions').select('id, title, site_id, assigned_contact_id, assigned_company_id, due_date').in('site_id', siteIds).eq('status', 'open') : Promise.resolve({ data: [] }),
  ])

  const companyIdByContact = new Map(
    ((contactRes.data ?? []) as Array<{ id: string; company_id: string | null }>).map((c) => [c.id, c.company_id]),
  )

  // Nœuds acteurs depuis le cockpit (personnes = contacts uniquement en V1).
  const persons = cockpit.actors
    .filter((a) => a.kind === 'person' && companyIdByContact.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, sub: a.subtitle || null, level: a.attention.level, historical: a.status === 'historical', companyId: companyIdByContact.get(a.id) ?? null }))
  const companies = cockpit.actors.filter((a) => a.kind === 'company').map((a) => ({ id: a.id, name: a.name, sub: a.subtitle || null, level: a.attention.level, historical: a.status === 'historical' }))
  const teams = cockpit.actors.filter((a) => a.kind === 'team').map((a) => ({ id: a.id, name: a.name, sub: a.subtitle || null, level: a.attention.level, historical: a.status === 'historical' }))

  return buildActorsGraph({
    persons,
    companies,
    teams,
    siteNames,
    fieldMemberships: ((tfmRes.data ?? []) as Array<{ contact_id: string; team_id: string }>).map((r) => ({ contactId: r.contact_id, teamId: r.team_id })),
    missions: ((missionRes.data ?? []) as Array<{ site_id: string; assigned_team_id: string }>).map((r) => ({ siteId: r.site_id, teamId: r.assigned_team_id })),
    casting: ((castingRes.data ?? []) as Array<{ company_id: string; site_id: string }>).map((r) => ({ companyId: r.company_id, siteId: r.site_id })),
    openActions: ((actionRes.data ?? []) as Array<{ id: string; title: string; site_id: string; assigned_contact_id: string | null; assigned_company_id: string | null; due_date: string | null }>)
      .map((r) => ({ id: r.id, title: r.title, siteId: r.site_id, contactId: r.assigned_contact_id, companyId: r.assigned_company_id, overdue: !!r.due_date && r.due_date < today })),
  })
}
