import 'server-only'

// M2B — LA FRONTIÈRE DE LECTURE COMMUNE À TOUTES LES RESSOURCES.
//
// P0 et P0.5 ont fermé des fuites d'accès direct par ID (chantier, puis
// clients/interventions/missions/contrats), chacune avec sa garde ponctuelle :
// `userCanAccessSite`, `userCanAccessOrgRow`. Trois primitives disaient la même
// règle. M2B les remplace par UNE.
//
// ── LE POINT CENTRAL : L'ORG VIENT DE LA RESSOURCE, JAMAIS DU CALLER ────────
//
// Le moteur ne demande JAMAIS `getOrgId()`. Il part de l'organisation
// PROPRIÉTAIRE de la ressource, puis vérifie que l'utilisateur en est membre.
// C'est ce qui le rend correct pour un compte multi-organisations : aucune
// ambiguïté à lever, donc aucun `OrganisationAmbigueError`.
//
// ── DEUX NIVEAUX ────────────────────────────────────────────────────────────
//
//   · resolveResourceAccess → résultat DISCRIMINÉ, ne lève jamais. Pour les
//     primitives internes (getSiteIdentity) qui ont leur propre contrat `null`.
//   · requireResourceAccess + façades → applique la politique de SURFACE et
//     refuse directement. Pour les pages.
//
// ── NE PAS CONFONDRE AUTHENTIFICATION ET CLOISONNEMENT ─────────────────────
//
// « non authentifié » n'est PAS « non autorisé ». Le premier garde la
// convention du dépôt (redirection /login) ; le second, comme toute lecture par
// ID refusée, produit un 404 uniforme — ressource inexistante et ressource
// étrangère sont indiscernables, aucun oracle.
//
// ── AUCUNE EXEMPTION DE RÔLE ────────────────────────────────────────────────
//
// `users.role === 'admin'` (plateforme) n'ouvre pas les données métier
// (doctrine `pouvoir-plateforme-vs-metier`). L'accès passe TOUJOURS par
// l'appartenance à l'organisation de la ressource.

import { redirect, notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import type { UserRole } from '@/types/db'

/** Le rôle DANS l'organisation de la ressource — jamais le rôle plateforme. */
export type OrganizationMembershipRole = UserRole

/** Liste FERMÉE. Aucun nom de table ne circule hors de ce module.
 *  `site_action` sert la FRONTIÈRE D'ÉCRITURE (M2C) : une action porte son
 *  `organization_id` (M2A), donc son propriétaire se résout sans jointure. La
 *  résolution est commune lecture/écriture ; seule la POLITIQUE diffère (elle
 *  vit dans `site-write-access.ts`). */
export type ResourceKind = 'site' | 'client' | 'mission' | 'intervention' | 'contract' | 'site_action'

/** M2B ne traite que la LECTURE : pas de champ `permission`. M2C étendra aux
 *  écritures avec une politique explicite. */
export interface ResourceAccessRequest {
  kind: ResourceKind
  id: string
}

export interface ResourceAccessContext {
  resourceId: string
  organizationId: string
  membershipRole: OrganizationMembershipRole
  /** L'utilisateur résolu — évite à l'appelant (notamment la frontière
   *  d'écriture M2C) de relire la session pour un `created_by`/`actor`. */
  userId: string
}

/**
 * Résultat DISCRIMINÉ. Les `reason` distinguent en interne ce que la surface
 * masque ensuite — notamment `unauthenticated`, qui ne doit pas devenir un 404.
 */
export type ResourceAccessResolution =
  | { ok: true; context: ResourceAccessContext }
  | {
      ok: false
      reason:
        | 'unauthenticated'
        | 'not_found'
        | 'missing_organization'
        | 'membership_missing'
        | 'membership_inactive'
    }

// ── RÉSOLVEURS ──────────────────────────────────────────────────────────────
// Cinq résolveurs NOMMÉS, même si le SQL est aujourd'hui uniforme : une
// ressource pourra changer de modèle sans toucher aux autres, et les tests
// restent lisibles par famille. La mécanique SELECT est factorisée dans une
// fonction privée à liste fermée — les noms de tables ne circulent jamais.

const ORG_TABLES = {
  site: 'sites',
  client: 'clients',
  mission: 'missions',
  intervention: 'interventions',
  contract: 'contracts',
  site_action: 'site_actions',
} as const

/**
 * L'organisation d'une ligne d'une table CONNUE.
 *   · `undefined` = la ligne n'existe pas ;
 *   · `null`      = elle existe mais sans organisation (anomalie) ;
 *   · string      = l'organisation propriétaire.
 */
async function selectOrganizationIdFromKnownTable(
  table: (typeof ORG_TABLES)[ResourceKind],
  id: string,
): Promise<string | null | undefined> {
  const { data, error } = await createAdminClient()
    .from(table)
    .select('organization_id')
    .eq('id', id)
    .maybeSingle()
  if (error) return undefined
  if (!data) return undefined
  return (data as { organization_id: string | null }).organization_id ?? null
}

async function resolveSiteOrganization(id: string) { return selectOrganizationIdFromKnownTable(ORG_TABLES.site, id) }
async function resolveClientOrganization(id: string) { return selectOrganizationIdFromKnownTable(ORG_TABLES.client, id) }
async function resolveMissionOrganization(id: string) { return selectOrganizationIdFromKnownTable(ORG_TABLES.mission, id) }
async function resolveInterventionOrganization(id: string) { return selectOrganizationIdFromKnownTable(ORG_TABLES.intervention, id) }
async function resolveContractOrganization(id: string) { return selectOrganizationIdFromKnownTable(ORG_TABLES.contract, id) }
async function resolveSiteActionOrganization(id: string) { return selectOrganizationIdFromKnownTable(ORG_TABLES.site_action, id) }

const resourceResolvers = {
  site: resolveSiteOrganization,
  client: resolveClientOrganization,
  mission: resolveMissionOrganization,
  intervention: resolveInterventionOrganization,
  contract: resolveContractOrganization,
  site_action: resolveSiteActionOrganization,
} satisfies Record<ResourceKind, (id: string) => Promise<string | null | undefined>>

// ── LE CŒUR ─────────────────────────────────────────────────────────────────

/**
 * Résout l'accès SANS jamais lever. L'ordre est la doctrine :
 * authentification → organisation DE LA RESSOURCE → appartenance active.
 */
export async function resolveResourceAccess(req: ResourceAccessRequest): Promise<ResourceAccessResolution> {
  if (!req.id) return { ok: false, reason: 'not_found' }

  const user = await getCurrentUserWithProfile().catch(() => null)
  if (!user) return { ok: false, reason: 'unauthenticated' }

  const orgId = await resourceResolvers[req.kind](req.id)
  if (orgId === undefined) return { ok: false, reason: 'not_found' }
  if (orgId === null) {
    // Anomalie structurelle : après M2A une ressource métier connaît toujours
    // son organisation. On refuse ET on la rend observable côté serveur.
    console.error(`[resource-access] ${req.kind} ${req.id} sans organization_id — refus`)
    return { ok: false, reason: 'missing_organization' }
  }

  // Lecture DISCRIMINÉE de l'appartenance : « pas membre » et « suspendu »
  // mènent au même 404 externe, mais on les sépare pour l'observabilité.
  const { data, error } = await createAdminClient()
    .from('organization_memberships')
    .select('role, status')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (error || !data) return { ok: false, reason: 'membership_missing' }
  const m = data as { role: UserRole; status: string }
  if (m.status !== 'active') return { ok: false, reason: 'membership_inactive' }

  return { ok: true, context: { resourceId: req.id, organizationId: orgId, membershipRole: m.role, userId: user.id } }
}

/**
 * Exige l'accès et applique la POLITIQUE DE SURFACE :
 *   · non authentifié → redirection /login (convention du dépôt) ;
 *   · tout autre refus → notFound() (404 uniforme, aucun oracle).
 * Rend le contexte de sécurité aux appelants qui en ont besoin.
 */
export async function requireResourceAccess(req: ResourceAccessRequest): Promise<ResourceAccessContext> {
  const r = await resolveResourceAccess(req)
  if (r.ok) return r.context
  if (r.reason === 'unauthenticated') redirect('/login')
  notFound()
}

// ── FAÇADES TYPÉES (pages) ──────────────────────────────────────────────────
export const requireSiteAccess         = (id: string) => requireResourceAccess({ kind: 'site', id })
export const requireClientAccess       = (id: string) => requireResourceAccess({ kind: 'client', id })
export const requireMissionAccess      = (id: string) => requireResourceAccess({ kind: 'mission', id })
export const requireInterventionAccess = (id: string) => requireResourceAccess({ kind: 'intervention', id })
export const requireContractAccess     = (id: string) => requireResourceAccess({ kind: 'contract', id })
