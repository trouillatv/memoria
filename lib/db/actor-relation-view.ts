import 'server-only'

// Composition SERVEUR des relations d'un acteur (V3, étape 5A). Un seul point de
// lecture : récupère les interactions org-scopées (étape 2), résout les libellés et
// hrefs des acteurs liés + des sources réelles, puis délègue au read model PUR
// (buildActorRelationViews) — asOf injecté ici, une seule fois. Aucune logique de
// score/tendance dupliquée : tout vient des fonctions pures.

import { createAdminClient } from '@/lib/supabase/admin'
import { getActorInteractions } from '@/lib/db/actor-interactions'
import {
  buildActorRelationViews, groupEcosystem,
  type ActorRelationsResult, type RelationViewLabels,
} from '@/lib/knowledge/actor-relation-view'
import type { ActorInteraction, ActorInteractionKind, ActorRef } from '@/lib/knowledge/actor-interactions'

export type { ActorRelationsResult }

const KIND_FALLBACK: Record<'person' | 'company', string> = { person: 'Personne', company: 'Entreprise' }

/** Relations d'un acteur, triées et expliquées, prêtes pour l'UI. Fail-closed :
 *  l'acteur doit appartenir à l'org (sinon résultat vide). `asOf` injecté. */
export async function getActorRelations(kind: 'person' | 'company', id: string, orgIds: string[], asOf: Date): Promise<ActorRelationsResult> {
  const empty: ActorRelationsResult = { relations: [], ecosystem: { principal: [], recent: [], inactive: [] } }
  if (orgIds.length === 0) return empty
  const db = createAdminClient()

  const table = kind === 'person' ? 'company_contacts' : 'companies'
  const { data: owner } = await db.from(table).select('id').eq('id', id).in('organization_id', orgIds).maybeSingle()
  if (!owner) return empty

  const self: ActorRef = { kind, id }
  const selfKey = `${kind}:${id}`
  const all = await getActorInteractions(orgIds)
  const mine = all.filter((i) => `${i.actorA.kind}:${i.actorA.id}` === selfKey || `${i.actorB.kind}:${i.actorB.id}` === selfKey)
  if (mine.length === 0) return empty

  // ── Ids à résoudre (acteurs liés + sources) ──
  const personIds = new Set<string>(), companyIds = new Set<string>()
  const siteIds = new Set<string>(), teamIds = new Set<string>(), actionIds = new Set<string>()
  const noteActor = (r: ActorRef) => { if (r.id === id && r.kind === kind) return; (r.kind === 'person' ? personIds : companyIds).add(r.id) }
  for (const i of mine) {
    noteActor(i.actorA); noteActor(i.actorB)
    if (i.kind === 'co_casting' && i.siteId) siteIds.add(i.siteId)
    else if (i.kind === 'co_team' && i.teamId) teamIds.add(i.teamId)
    else if (i.kind === 'co_action' && i.actionId) actionIds.add(i.actionId)
  }

  const [personRes, companyRes, siteRes, teamRes, actionRes] = await Promise.all([
    personIds.size ? db.from('company_contacts').select('id, full_name').in('id', [...personIds]) : Promise.resolve({ data: [] }),
    companyIds.size ? db.from('companies').select('id, name').in('id', [...companyIds]) : Promise.resolve({ data: [] }),
    siteIds.size ? db.from('sites').select('id, name').in('id', [...siteIds]) : Promise.resolve({ data: [] }),
    teamIds.size ? db.from('teams').select('id, name').in('id', [...teamIds]) : Promise.resolve({ data: [] }),
    actionIds.size ? db.from('site_actions').select('id, title').in('id', [...actionIds]) : Promise.resolve({ data: [] }),
  ])
  const personName = new Map(((personRes.data ?? []) as Array<{ id: string; full_name: string }>).map((r) => [r.id, r.full_name]))
  const companyName = new Map(((companyRes.data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]))
  const siteName = new Map(((siteRes.data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]))
  const teamName = new Map(((teamRes.data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]))
  const actionTitle = new Map(((actionRes.data ?? []) as Array<{ id: string; title: string }>).map((r) => [r.id, r.title]))

  const labels: RelationViewLabels = {
    actor: (ref) => {
      const label = ref.kind === 'person' ? personName.get(ref.id) : companyName.get(ref.id)
      const href = ref.kind === 'person' ? `/intervenants/personne/${ref.id}` : `/intervenants/entreprise/${ref.id}`
      // Libellé manquant (acteur archivé/introuvable) → type générique, jamais inventé.
      return { kind: ref.kind, id: ref.id, label: label ?? KIND_FALLBACK[ref.kind], href }
    },
    source: (skind: ActorInteractionKind, sourceId: string) => {
      if (skind === 'co_casting') return { label: siteName.get(sourceId) ?? 'Chantier', href: `/sites/${sourceId}` }
      if (skind === 'co_team') return { label: teamName.get(sourceId) ?? 'Équipe', href: `/equipes/${sourceId}` }
      // co_action : pas de route de détail fiable → non cliquable ; titre réel si connu.
      return { label: actionTitle.get(sourceId) ?? 'Action', href: null }
    },
  }

  const relations = buildActorRelationViews(self, mine as ActorInteraction[], asOf, labels)
  return { relations, ecosystem: groupEcosystem(relations) }
}
