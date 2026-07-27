import 'server-only'

// ── GRAPHE DES ACTEURS — FETCHERS SERVEUR ────────────────────────────────────
// Le MODÈLE (types, libellés, buildActorsGraph, egoSubgraph, shortestPath) vit
// dans ./actors-graph-model (sans 'server-only', importable côté client) et est
// ré-exporté ici pour les modules serveur. Ce fichier n'ajoute que la couche I/O :
// getActorsGraph (vue globale filtrée par pertinence) et getActorNetwork
// (ego-graph centré). État d'attention = getActorsCockpit (source unique).

import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { getActorsCockpit } from '@/lib/db/actors-cockpit'
import type { AttentionLevel } from '@/lib/knowledge/actor-attention'
import { buildActorsGraph, egoSubgraph, type ActorsGraph } from './actors-graph-model'

export * from './actors-graph-model'

/**
 * Graphe des acteurs de l'organisation. Réutilise getActorsCockpit (état d'attention =
 * source unique) et ajoute la couche relationnelle par des lectures filtrées. Fail-closed :
 * sans org → graphe vide. Personnes = company_contacts (les comptes purs sont hors V1).
 *
 * `unfiltered` : ignore la règle de pertinence (garde tous les acteurs, y compris
 * historiques) — utile pour extraire un ego-graph centré (getActorNetwork), où les
 * relations historiques de l'acteur sont pertinentes.
 */
export async function getActorsGraph(orgIds: string[], opts?: { unfiltered?: boolean }): Promise<ActorsGraph> {
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
    db.from('team_field_members').select('contact_id, team_id, joined_at').is('left_at', null).in('organization_id', orgIds),
    siteIds.length ? db.from('missions').select('site_id, assigned_team_id').in('site_id', siteIds).is('deleted_at', null).not('assigned_team_id', 'is', null) : Promise.resolve({ data: [] }),
    siteIds.length ? db.from('site_intervenants').select('company_id, site_id, effective_from').in('site_id', siteIds).is('effective_to', null) : Promise.resolve({ data: [] }),
    siteIds.length ? db.from('site_actions').select('id, title, site_id, assigned_contact_id, assigned_company_id, due_date').in('site_id', siteIds).eq('status', 'open') : Promise.resolve({ data: [] }),
  ])

  const companyIdByContact = new Map(
    ((contactRes.data ?? []) as Array<{ id: string; company_id: string | null }>).map((c) => [c.id, c.company_id]),
  )

  // RÈGLE DE PERTINENCE (vue globale, Vincent 2026-07-27) : on garde les acteurs ACTIFS
  // et tout ce qui a de l'attention (level ≠ ok). Un historique n'apparaît que s'il porte
  // encore une relation active — or ce cas produit toujours une attention ≠ ok (ex. encore
  // responsable d'une action ouverte → responsible_not_active / company_left_casting). Un
  // ancien contact sans équipe/chantier/action (historique + ok) est donc masqué.
  const relevant = (a: { status: string; attention: { level: AttentionLevel } }) => opts?.unfiltered || a.status === 'active' || a.attention.level !== 'ok'
  const persons = cockpit.actors
    .filter((a) => a.kind === 'person' && companyIdByContact.has(a.id) && relevant(a))
    .map((a) => ({ id: a.id, name: a.name, sub: a.subtitle || null, level: a.attention.level, historical: a.status === 'historical', companyId: companyIdByContact.get(a.id) ?? null }))
  const companies = cockpit.actors.filter((a) => a.kind === 'company' && relevant(a)).map((a) => ({ id: a.id, name: a.name, sub: a.subtitle || null, level: a.attention.level, historical: a.status === 'historical' }))
  const teams = cockpit.actors.filter((a) => a.kind === 'team' && relevant(a)).map((a) => ({ id: a.id, name: a.name, sub: a.subtitle || null, level: a.attention.level, historical: a.status === 'historical' }))

  return buildActorsGraph({
    persons,
    companies,
    teams,
    siteNames,
    fieldMemberships: ((tfmRes.data ?? []) as Array<{ contact_id: string; team_id: string; joined_at: string | null }>).map((r) => ({ contactId: r.contact_id, teamId: r.team_id, joinedAt: r.joined_at })),
    missions: ((missionRes.data ?? []) as Array<{ site_id: string; assigned_team_id: string }>).map((r) => ({ siteId: r.site_id, teamId: r.assigned_team_id })),
    casting: ((castingRes.data ?? []) as Array<{ company_id: string; site_id: string; effective_from: string | null }>).map((r) => ({ companyId: r.company_id, siteId: r.site_id, effectiveFrom: r.effective_from })),
    openActions: ((actionRes.data ?? []) as Array<{ id: string; title: string; site_id: string; assigned_contact_id: string | null; assigned_company_id: string | null; due_date: string | null }>)
      .map((r) => ({ id: r.id, title: r.title, siteId: r.site_id, contactId: r.assigned_contact_id, companyId: r.assigned_company_id, overdue: !!r.due_date && r.due_date < today })),
  })
}

/**
 * Ego-graph CENTRÉ sur un acteur (nodeId préfixé), à afficher DANS sa fiche. Inclut ses
 * relations historiques utiles (org non filtré) et son voisinage à `depth` sauts. Réutilise
 * intégralement getActorsGraph — aucune logique de relation dupliquée.
 */
export async function getActorNetwork(nodeId: string, orgIds: string[], depth = 2): Promise<ActorsGraph> {
  if (orgIds.length === 0) return { nodes: [], edges: [] }
  const full = await getActorsGraph(orgIds, { unfiltered: true })
  return egoSubgraph(full, nodeId, depth)
}
