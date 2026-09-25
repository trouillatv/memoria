import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteById } from '@/lib/db/sites'
import { listActiveEngagementsByContracts, listActiveEngagementsBySites, listEngagementsByIds } from '@/lib/db/engagements'
import type { DbEngagement, DbSiteActionEngagementLink } from '@/types/db'

// P0-4B — rapprochement humain Action ↔ Engagement (GO Vincent 2026-09-25).
// « Engagement = ce qui doit être vrai. Action = quelque chose qu'il faut
// traiter. » Ce module ne fait QUE ce lien déclaratif : jamais de conformité,
// d'écart, ni de mutation de l'Engagement ou de l'Action elle-même.

/**
 * Engagements candidats pour un rattachement MANUEL depuis un chantier :
 * Porte A (actifs du contrat du chantier) ∪ Porte B (actifs du chantier),
 * dédupliqués par id. Le filtre `active` ne s'applique QU'À la création d'un
 * nouveau lien — jamais à la lecture d'un lien déjà existant.
 */
export async function listCandidateEngagementsForSite(siteId: string): Promise<DbEngagement[]> {
  const site = await getSiteById(siteId)
  if (!site) return []
  const [byContract, bySite] = await Promise.all([
    site.contract_id ? listActiveEngagementsByContracts([site.contract_id]) : Promise.resolve(new Map<string, DbEngagement[]>()),
    listActiveEngagementsBySites([siteId]),
  ])
  // listActiveEngagementsByContracts() retourne volontairement active+completed
  // pour P0-3.5A (Mission) — ne pas modifier ce helper partagé. P0-4B exige
  // status='active' au moment du rattachement : filtrer ici, localement.
  const porteA = (site.contract_id ? byContract.get(site.contract_id) ?? [] : []).filter((e) => e.status === 'active')
  const byId = new Map<string, DbEngagement>()
  for (const e of [...porteA, ...(bySite.get(siteId) ?? [])]) {
    byId.set(e.id, e)
  }
  return [...byId.values()]
}

export interface SiteActionEngagementLinkView {
  link: DbSiteActionEngagementLink
  engagement: DbEngagement
}

/**
 * Engagements déjà rapprochés d'une Action, quel que soit leur statut actuel
 * (préservation historique — cf. listEngagementsByIds).
 */
export async function listEngagementLinksForAction(siteActionId: string): Promise<SiteActionEngagementLinkView[]> {
  const supabase = createAdminClient()
  const { data: links, error } = await supabase
    .from('site_action_engagement_links')
    .select('*')
    .eq('site_action_id', siteActionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (links ?? []) as DbSiteActionEngagementLink[]
  if (rows.length === 0) return []
  const engagements = await listEngagementsByIds(rows.map((r) => r.engagement_id))
  const engagementById = new Map(engagements.map((e) => [e.id, e]))
  return rows
    .map((link) => {
      const engagement = engagementById.get(link.engagement_id)
      return engagement ? { link, engagement } : null
    })
    .filter((v): v is SiteActionEngagementLinkView => v !== null)
}

export type CreateEngagementLinkResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

/**
 * Crée le rapprochement, en revalidant CÔTÉ SERVEUR tous les invariants —
 * jamais en confiance depuis le client. `organizationId` vient de la
 * frontière d'écriture (M2C, `requireSiteActionWriteAccess`), pas du client.
 */
export async function createSiteActionEngagementLink(input: {
  siteActionId: string
  engagementId: string
  organizationId: string
  createdBy: string | null
}): Promise<CreateEngagementLinkResult> {
  const supabase = createAdminClient()

  const { data: action } = await supabase
    .from('site_actions')
    .select('id, site_id, organization_id')
    .eq('id', input.siteActionId)
    .maybeSingle()
  if (!action || action.organization_id !== input.organizationId) {
    return { ok: false, error: 'Accès refusé' }
  }

  const site = await getSiteById(action.site_id as string)
  if (!site || site.organization_id !== input.organizationId) {
    return { ok: false, error: 'Accès refusé' }
  }

  const { data: engagement } = await supabase
    .from('engagements')
    .select('id, status, site_id, contract_id, organization_id')
    .eq('id', input.engagementId)
    .maybeSingle()
  if (!engagement || engagement.organization_id !== input.organizationId) {
    return { ok: false, error: 'Accès refusé' }
  }
  if (engagement.status !== 'active') {
    return { ok: false, error: 'Cet engagement n\'est plus actif' }
  }
  const porteB = engagement.site_id != null && engagement.site_id === site.id
  const porteA = engagement.contract_id != null && site.contract_id != null && engagement.contract_id === site.contract_id
  if (!porteB && !porteA) {
    return { ok: false, error: 'Cet engagement ne s\'applique pas à ce chantier' }
  }

  const { data: existing } = await supabase
    .from('site_action_engagement_links')
    .select('id')
    .eq('site_action_id', input.siteActionId)
    .eq('engagement_id', input.engagementId)
    .maybeSingle()
  if (existing) return { ok: true, id: existing.id as string }

  const { data: inserted, error } = await supabase
    .from('site_action_engagement_links')
    .insert({
      organization_id: input.organizationId,
      site_id: site.id,
      site_action_id: input.siteActionId,
      engagement_id: input.engagementId,
      created_by: input.createdBy,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: 'Échec de l\'enregistrement' }
  return { ok: true, id: inserted.id as string }
}

/** Retire le rapprochement — n'a AUCUN effet sur l'Action ou l'Engagement eux-mêmes. */
export async function removeSiteActionEngagementLink(input: {
  linkId: string
  siteActionId: string
  organizationId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient()
  // La racine d'autorisation (M2C) est l'Action : le lien retiré doit être
  // exactement celui de cette Action, jamais un lien d'une autre Action de
  // la même organisation.
  const { data, error } = await supabase
    .from('site_action_engagement_links')
    .delete()
    .eq('id', input.linkId)
    .eq('site_action_id', input.siteActionId)
    .eq('organization_id', input.organizationId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: 'Échec du retrait' }
  if (!data) return { ok: false, error: 'Accès refusé' }
  return { ok: true }
}
