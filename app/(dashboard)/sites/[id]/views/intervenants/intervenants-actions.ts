'use server'

// Les gestes de l'onglet Intervenants — réutiliser une personne DÉJÀ connue de
// l'organisation sans la recréer (cadrage validé 2026-07-18, point 4 du lot).
// La confirmation d'une proposition, elle, passe par promoteFromMemoryAction :
// un seul cycle de promotion, jamais un second mécanisme.

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { openSiteIntervenant } from '@/lib/db/site-intervenants'
import { logUsageEvent } from '@/lib/db/usage-events'

// FRONTIÈRE M2C. Avant : `requireManagerOrAdmin` (rôle du profil) + `requireSiteInOrg`
// (org du caller via `getOrgId`). Ces deux gestes reposaient sur l'org PAR DÉFAUT
// du profil — cassés en multi-org. Désormais tout passe par `requireSiteWriteAccess(
// siteId, 'managerOrAdmin')` : org DU CHANTIER → membership actif → rôle. Les
// recherches d'aide en héritent : le `site_id` reçu EST leur contexte métier (on
// cherche dans l'organisation qui possède ce chantier), résolu côté serveur.

const ficheOpenedSchema = z.object({
  site_id: z.string().uuid(),
  /** D'où la fiche a été ouverte — c'est LA donnée de l'observation : les
   *  conducteurs pensent-ils « une personne » (onglet) ou « une situation »
   *  (visite, Explorer, recherche…) ? Nouveau point d'entrée = nouvelle valeur. */
  source: z.enum(['tab', 'apercu', 'explorer', 'recherche', 'visite', 'action']),
})

/** Trace l'ouverture d'une fiche intervenant (best-effort, ne lève jamais). */
export async function logIntervenantFicheOpenedAction(
  input: z.input<typeof ficheOpenedSchema>,
): Promise<void> {
  const parsed = ficheOpenedSchema.safeParse(input)
  if (!parsed.success) return
  await logUsageEvent({
    event: `intervenant_fiche_opened:${parsed.data.source}`,
    siteId: parsed.data.site_id,
  })
}

const actionOpenedSchema = z.object({
  site_id: z.string().uuid(),
  /** La destination effective (P2 Slice 3B) : la réunion source ou l'onglet
   *  Travail. C'est le signal utile — best-effort, jamais bloquant, aucune
   *  donnée nominative. (logUsageEvent ne porte que event+siteId : l'actionId/
   *  contactId ne sont pas persistés ici, ce serait une extension hors slice.) */
  destination: z.enum(['report', 'site_work']),
})

/** Trace l'ouverture d'une action depuis une fiche (best-effort, ne lève jamais,
 *  ne bloque jamais la navigation). */
export async function logIntervenantActionOpenedAction(
  input: z.input<typeof actionOpenedSchema>,
): Promise<void> {
  const parsed = actionOpenedSchema.safeParse(input)
  if (!parsed.success) return
  await logUsageEvent({
    event: `intervenant_action_opened:${parsed.data.destination}`,
    siteId: parsed.data.site_id,
  })
}

export interface OrgContactHit {
  contactId: string
  name: string
  fonction: string | null
  companyId: string
  companyName: string
}

const searchSchema = z.object({ site_id: z.string().uuid(), q: z.string().trim().min(2).max(120) })

/** Chercher une personne dans le registre de l'organisation (« Associer une
 *  personne existante… »). Lecture seule, bornée. */
export async function searchOrgContactsAction(
  input: z.input<typeof searchSchema>,
): Promise<{ ok: true; hits: OrgContactHit[] } | { ok: false; error: string }> {
  const parsed = searchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Recherche invalide' }
  const access = await requireSiteWriteAccess(parsed.data.site_id, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: 'Chantier introuvable' }
  const orgId = access.organizationId

  const db = createAdminClient()
  const { data: companies } = await db
    .from('companies').select('id, name, short_name').eq('organization_id', orgId).is('deleted_at', null)
  const nameById = new Map((companies ?? []).map((c) => [
    c.id as string, ((c.short_name as string | null) || (c.name as string)) ?? '',
  ]))
  if (nameById.size === 0) return { ok: true, hits: [] }
  const { data: contacts } = await db
    .from('company_contacts')
    .select('id, full_name, function, company_id')
    .in('company_id', [...nameById.keys()])
    .is('deleted_at', null)
    .ilike('full_name', `%${parsed.data.q}%`)
    .order('full_name', { ascending: true })
    .limit(8)
  return {
    ok: true,
    hits: ((contacts ?? []) as Array<{ id: string; full_name: string; function: string | null; company_id: string }>).map((c) => ({
      contactId: c.id,
      name: c.full_name,
      fonction: c.function,
      companyId: c.company_id,
      companyName: nameById.get(c.company_id) ?? '',
    })),
  }
}

const associateSchema = z.object({
  site_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  role: z.string().trim().min(1).max(60),
})

/** Rattacher une personne DÉJÀ connue au chantier courant, avec un rôle propre
 *  à ce chantier. La personne n'est jamais recréée — c'est tout l'intérêt. */
export async function associateContactAction(
  input: z.input<typeof associateSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = associateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const access = await requireSiteWriteAccess(parsed.data.site_id, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: 'Chantier introuvable' }
  const orgId = access.organizationId

  const db = createAdminClient()
  // Le contact doit appartenir à une entreprise de NOTRE org (garde IDOR).
  const { data: contact } = await db
    .from('company_contacts').select('id, company_id').eq('id', parsed.data.contact_id).is('deleted_at', null).maybeSingle()
  if (!contact) return { ok: false, error: 'Personne introuvable' }
  const { data: company } = await db
    .from('companies').select('id, organization_id').eq('id', contact.company_id as string).maybeSingle()
  if (!company || (company as { organization_id: string | null }).organization_id !== orgId) {
    return { ok: false, error: 'Personne introuvable' }
  }

  try {
    await openSiteIntervenant({
      siteId: parsed.data.site_id,
      role: parsed.data.role,
      companyId: contact.company_id as string,
      mainContactId: contact.id as string,
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Association impossible' }
  }
}

// ── RATTACHER UNE MENTION À UNE IDENTITÉ CONNUE (Vincent, 2026-07-22) ────────
//
// « À identifier » n'offrait que deux issues : confirmer comme NOUVEL
// intervenant, ou ne pas retenir. L'écran poussait donc mécaniquement au
// doublon : « Clim Expert », « AGP SARL » et « Yan » créaient des identités à
// côté de celles qui existaient déjà.
//
// Trois cas, et ils ne se traitent pas pareil :
//   · même identité, autre orthographe (« Yan » → Yann Leroy) ;
//   · métier ou description (« l'électricien ») — rattachable, mais SEULEMENT
//     par décision humaine, jamais par ressemblance ;
//   · entreprise citée à la place d'une personne (« AGP ») → on rattache à
//     l'ENTREPRISE, on ne fabrique pas un contact au nom de la société.
//
// D'où une recherche qui rend les DEUX natures, et dit lesquelles sont déjà sur
// ce chantier — c'est presque toujours la bonne réponse.

export interface IntervenantTarget {
  kind: 'company' | 'contact'
  /** L'entreprise visée ; pour un contact, celle sous laquelle il vit. */
  companyId: string
  companyName: string
  /** Renseigné pour un contact seulement. */
  contactId?: string
  name: string
  fonction: string | null
  /** Déjà au casting de ce chantier — et sous quel(s) rôle(s). */
  onThisSite: boolean
  /** Le rôle déjà en vigueur : il évite de reposer la question. */
  knownRole: string | null
}

export async function searchIntervenantTargetsAction(
  input: z.input<typeof searchSchema>,
): Promise<{ ok: true; hits: IntervenantTarget[] } | { ok: false; error: string }> {
  const parsed = searchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Recherche invalide' }
  const access = await requireSiteWriteAccess(parsed.data.site_id, 'managerOrAdmin')
  if (!access.ok) return { ok: false, error: 'Chantier introuvable' }
  const orgId = access.organizationId

  const db = createAdminClient()
  const q = parsed.data.q
  const { data: companies } = await db
    .from('companies')
    .select('id, name, short_name')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
  const rows = (companies ?? []) as Array<{ id: string; name: string; short_name: string | null }>
  if (rows.length === 0) return { ok: true, hits: [] }
  const labelById = new Map(rows.map((c) => [c.id, (c.short_name || c.name || '').trim()]))

  // Le casting en vigueur : c'est lui qui distingue « déjà ici » de « ailleurs
  // dans l'organisation », et qui donne le rôle sans le redemander.
  const { data: casting } = await db
    .from('site_intervenants')
    .select('company_id, role')
    .eq('site_id', parsed.data.site_id)
    .is('effective_to', null)
  const roleByCompany = new Map(
    ((casting ?? []) as Array<{ company_id: string; role: string }>).map((c) => [c.company_id, c.role]),
  )

  const needle = q.toLowerCase()
  const matchedCompanies = rows.filter(
    (c) => (c.name ?? '').toLowerCase().includes(needle) || (c.short_name ?? '').toLowerCase().includes(needle),
  )

  const { data: contacts } = await db
    .from('company_contacts')
    .select('id, full_name, function, company_id')
    .in('company_id', [...labelById.keys()])
    .is('deleted_at', null)
    .ilike('full_name', `%${q}%`)
    .order('full_name', { ascending: true })
    .limit(8)

  const hits: IntervenantTarget[] = [
    ...matchedCompanies.slice(0, 8).map((c) => ({
      kind: 'company' as const,
      companyId: c.id,
      companyName: labelById.get(c.id) ?? c.name,
      name: labelById.get(c.id) ?? c.name,
      fonction: null,
      onThisSite: roleByCompany.has(c.id),
      knownRole: roleByCompany.get(c.id) ?? null,
    })),
    ...((contacts ?? []) as Array<{ id: string; full_name: string; function: string | null; company_id: string }>).map((c) => ({
      kind: 'contact' as const,
      companyId: c.company_id,
      companyName: labelById.get(c.company_id) ?? '',
      contactId: c.id,
      name: c.full_name,
      fonction: c.function,
      onThisSite: roleByCompany.has(c.company_id),
      knownRole: roleByCompany.get(c.company_id) ?? null,
    })),
  ]
  // Ce qui est déjà sur ce chantier remonte : c'est la réponse la plus probable.
  hits.sort((a, b) => Number(b.onThisSite) - Number(a.onThisSite))
  return { ok: true, hits }
}
