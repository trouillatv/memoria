// CASTING DU CHANTIER (mig 137) — le mapping PAR SITE : rôle → entreprise → contact.
// Le RÔLE vit ICI (lien site↔entreprise), pas dans companies (une entreprise = ETV
// ici, sous-traitant ailleurs). C'est ce qui fait passer MemorIA des codes nus
// (« ETV ») aux vrais acteurs (« ETV · BatiSud · Jean Dupont »).
import { createAdminClient } from '@/lib/supabase/admin'

export interface SiteIntervenant {
  id: string
  siteId: string
  role: string
  companyId: string
  companyName: string
  companyShort: string | null
  mainContactId: string | null
  contactName: string | null
  contactPhone: string | null
  contactMobile: string | null
  contactEmail: string | null
}

/** Casting complet d'un site (rôle → entreprise → contact), stitché à la main
 *  (robuste vs embeddings ; volumes faibles). */
export async function listSiteIntervenants(siteId: string): Promise<SiteIntervenant[]> {
  const sb = createAdminClient()
  const { data: rows } = await sb
    .from('site_intervenants')
    .select('id, site_id, role, company_id, main_contact_id, created_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: true })
  const list = rows ?? []
  if (list.length === 0) return []

  const companyIds = [...new Set(list.map((r) => r.company_id as string))]
  const contactIds = list.map((r) => r.main_contact_id as string | null).filter((x): x is string => !!x)

  const { data: companies } = await sb.from('companies').select('id, name, short_name').in('id', companyIds)
  const companyById = new Map((companies ?? []).map((c) => [c.id as string, c]))
  const contactById = new Map<string, Record<string, unknown>>()
  if (contactIds.length > 0) {
    const { data: contacts } = await sb.from('company_contacts').select('id, full_name, phone, mobile, email').in('id', contactIds)
    for (const c of contacts ?? []) contactById.set(c.id as string, c)
  }

  return list.map((r) => {
    const c = companyById.get(r.company_id as string)
    const ct = r.main_contact_id ? contactById.get(r.main_contact_id as string) : undefined
    return {
      id: r.id as string,
      siteId: r.site_id as string,
      role: r.role as string,
      companyId: r.company_id as string,
      companyName: (c?.name as string) ?? '',
      companyShort: (c?.short_name as string | null) ?? null,
      mainContactId: (r.main_contact_id as string | null) ?? null,
      contactName: (ct?.full_name as string | null) ?? null,
      contactPhone: (ct?.phone as string | null) ?? null,
      contactMobile: (ct?.mobile as string | null) ?? null,
      contactEmail: (ct?.email as string | null) ?? null,
    }
  })
}

export async function upsertSiteIntervenant(input: {
  siteId: string
  role: string
  companyId: string
  mainContactId?: string | null
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_intervenants')
    .upsert(
      { site_id: input.siteId, role: input.role.trim().toUpperCase(), company_id: input.companyId, main_contact_id: input.mainContactId ?? null },
      { onConflict: 'site_id,role,company_id' },
    )
  if (error) throw new Error(error.message)
}

export async function deleteSiteIntervenant(siteId: string, id: string): Promise<void> {
  const { error } = await createAdminClient().from('site_intervenants').delete().eq('id', id).eq('site_id', siteId)
  if (error) throw new Error(error.message)
}

export interface RoleActor { company: string; contact: string | null }

/** Résolution rôle → acteur pour un site : « ETV » → { company:'BatiSud', contact:'Jean Dupont' }.
 *  Clé = rôle en MAJUSCULES. En cas de co-traitance (N entreprises/rôle), garde la 1ʳᵉ
 *  et concatène les noms. Sert l'affichage « ETV · BatiSud » dans la colonne ACTION. */
export async function getRoleActorMap(siteId: string): Promise<Map<string, RoleActor>> {
  const list = await listSiteIntervenants(siteId)
  const map = new Map<string, RoleActor>()
  for (const i of list) {
    const label = i.companyShort || i.companyName
    const existing = map.get(i.role)
    if (existing) existing.company = `${existing.company}, ${label}`
    else map.set(i.role, { company: label, contact: i.contactName })
  }
  return map
}
