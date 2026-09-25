import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteById } from '@/lib/db/sites'
import { listActiveEngagementsByContracts, listActiveEngagementsBySites, listEngagementsByIds } from '@/lib/db/engagements'
import type { DbEngagement, DbSiteActionEngagementLink, DbSiteActionEngagementLinkEvent, EngagementLinkQualification } from '@/types/db'

// P0-4B — rapprochement humain Action ↔ Engagement (GO Vincent 2026-09-25).
// « Engagement = ce qui doit être vrai. Action = quelque chose qu'il faut
// traiter. » Ce module ne fait QUE ce lien déclaratif : jamais de conformité,
// d'écart, ni de mutation de l'Engagement ou de l'Action elle-même.
//
// P0-4C (mig 440) — qualification humaine append-only du POURQUOI de ce lien.
// Le retrait d'un lien est désormais une fermeture logique (removed_at) : une
// qualification passée doit survivre au retrait du rapprochement.

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
  /** Événement de qualification le plus récent, ou null = « Non qualifié » (état valide). */
  currentQualification: DbSiteActionEngagementLinkEvent | null
  /** Historique complet, ordre chronologique croissant. Jamais de correction en place. */
  qualificationHistory: DbSiteActionEngagementLinkEvent[]
}

async function listQualificationEventsForLinks(linkIds: string[]): Promise<Map<string, DbSiteActionEngagementLinkEvent[]>> {
  const byLink = new Map<string, DbSiteActionEngagementLinkEvent[]>()
  if (linkIds.length === 0) return byLink
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_action_engagement_link_events')
    .select('*')
    .in('link_id', linkIds)
    .order('created_at', { ascending: true })
  if (error) throw error
  for (const row of (data ?? []) as DbSiteActionEngagementLinkEvent[]) {
    const arr = byLink.get(row.link_id) ?? []
    arr.push(row)
    byLink.set(row.link_id, arr)
  }
  return byLink
}

/**
 * Rapprochements ACTIFS d'une Action (removed_at IS NULL), quel que soit le
 * statut actuel de l'Engagement (préservation historique — cf.
 * listEngagementsByIds). Chaque vue porte sa qualification courante et son
 * historique complet.
 */
export async function listEngagementLinksForAction(siteActionId: string): Promise<SiteActionEngagementLinkView[]> {
  const supabase = createAdminClient()
  const { data: links, error } = await supabase
    .from('site_action_engagement_links')
    .select('*')
    .eq('site_action_id', siteActionId)
    .is('removed_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (links ?? []) as DbSiteActionEngagementLink[]
  if (rows.length === 0) return []
  const [engagements, eventsByLink] = await Promise.all([
    listEngagementsByIds(rows.map((r) => r.engagement_id)),
    listQualificationEventsForLinks(rows.map((r) => r.id)),
  ])
  const engagementById = new Map(engagements.map((e) => [e.id, e]))
  return rows
    .map((link) => {
      const engagement = engagementById.get(link.engagement_id)
      if (!engagement) return null
      const history = eventsByLink.get(link.id) ?? []
      const currentQualification = history.length > 0 ? history[history.length - 1] : null
      return { link, engagement, currentQualification, qualificationHistory: history }
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
    .is('removed_at', null)
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

/**
 * Retire le rapprochement — n'a AUCUN effet sur l'Action ou l'Engagement
 * eux-mêmes. P0-4C : fermeture LOGIQUE (removed_at/removed_by), jamais un
 * DELETE — une qualification passée doit survivre au retrait.
 */
export async function removeSiteActionEngagementLink(input: {
  linkId: string
  siteActionId: string
  organizationId: string
  removedBy: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient()
  // La racine d'autorisation (M2C) est l'Action : le lien retiré doit être
  // exactement celui de cette Action, jamais un lien d'une autre Action de
  // la même organisation. Seul un lien encore actif peut être retiré.
  const { data, error } = await supabase
    .from('site_action_engagement_links')
    .update({ removed_at: new Date().toISOString(), removed_by: input.removedBy })
    .eq('id', input.linkId)
    .eq('site_action_id', input.siteActionId)
    .eq('organization_id', input.organizationId)
    .is('removed_at', null)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: 'Échec du retrait' }
  if (!data) return { ok: false, error: 'Accès refusé' }
  return { ok: true }
}

export interface EngagementLinkOwner {
  siteActionId: string
  organizationId: string
}

/**
 * Résout la vraie Action et organisation propriétaires d'un lien ACTIF, pour
 * dériver l'autorité d'écriture (M2C) côté serveur — jamais depuis un
 * actionId fourni par le client. Un lien retiré n'est plus qualifiable.
 */
export async function resolveActiveEngagementLinkOwner(linkId: string): Promise<EngagementLinkOwner | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('site_action_engagement_links')
    .select('site_action_id, organization_id')
    .eq('id', linkId)
    .is('removed_at', null)
    .maybeSingle()
  if (!data) return null
  return { siteActionId: data.site_action_id as string, organizationId: data.organization_id as string }
}

/**
 * Ajoute un événement de qualification — APPEND-ONLY, jamais un UPDATE d'un
 * événement précédent. Ne répond qu'à « pourquoi ce lien ? », jamais à
 * « est-ce conforme ? ». Revalide côté serveur que le lien est actif et
 * appartient bien à `organizationId` (défense en profondeur, indépendante de
 * la résolution faite par l'appelant).
 */
export async function addEngagementLinkQualification(input: {
  linkId: string
  qualification: EngagementLinkQualification
  note: string | null
  organizationId: string
  createdBy: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient()
  const { data: link } = await supabase
    .from('site_action_engagement_links')
    .select('id')
    .eq('id', input.linkId)
    .eq('organization_id', input.organizationId)
    .is('removed_at', null)
    .maybeSingle()
  if (!link) return { ok: false, error: 'Accès refusé' }

  const { error } = await supabase
    .from('site_action_engagement_link_events')
    .insert({
      organization_id: input.organizationId,
      link_id: input.linkId,
      qualification: input.qualification,
      note: input.note,
      created_by: input.createdBy,
    })
  if (error) return { ok: false, error: 'Échec de l\'enregistrement' }
  return { ok: true }
}
