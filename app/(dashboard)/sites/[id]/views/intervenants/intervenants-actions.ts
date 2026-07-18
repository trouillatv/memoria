'use server'

// Les gestes de l'onglet Intervenants — réutiliser une personne DÉJÀ connue de
// l'organisation sans la recréer (cadrage validé 2026-07-18, point 4 du lot).
// La confirmation d'une proposition, elle, passe par promoteFromMemoryAction :
// un seul cycle de promotion, jamais un second mécanisme.

import { z } from 'zod'
import { getCurrentUserWithProfile, getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { openSiteIntervenant } from '@/lib/db/site-intervenants'
import { logUsageEvent } from '@/lib/db/usage-events'

async function requireManagerOrAdmin() {
  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Not authenticated')
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Forbidden')
  return user
}

/** Le chantier appartient-il à l'org de l'appelant ? Fail-closed : le
 *  service-role bypasse la RLS, la garde vit dans le code. */
async function requireSiteInOrg(siteId: string): Promise<string | null> {
  const orgId = await getOrgId()
  if (!orgId) return null
  const { data } = await createAdminClient()
    .from('sites').select('id, organization_id').eq('id', siteId).maybeSingle()
  if (!data || (data as { organization_id: string | null }).organization_id !== orgId) return null
  return orgId
}

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
  try {
    await requireManagerOrAdmin()
  } catch {
    return { ok: false, error: 'Non autorisé' }
  }
  const parsed = searchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Recherche invalide' }
  const orgId = await requireSiteInOrg(parsed.data.site_id)
  if (!orgId) return { ok: false, error: 'Chantier introuvable' }

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
  try {
    await requireManagerOrAdmin()
  } catch {
    return { ok: false, error: 'Non autorisé' }
  }
  const parsed = associateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const orgId = await requireSiteInOrg(parsed.data.site_id)
  if (!orgId) return { ok: false, error: 'Chantier introuvable' }

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
