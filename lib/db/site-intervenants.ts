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
  contactFunction: string | null
  contactPhone: string | null
  contactMobile: string | null
  contactEmail: string | null
}

/** Casting ACTIF d'un site (liens non clôturés : effective_to is null), rôle →
 *  entreprise → contact. Stitché à la main (robuste vs embeddings ; volumes faibles). */
export async function listSiteIntervenants(siteId: string): Promise<SiteIntervenant[]> {
  const sb = createAdminClient()
  const { data: rows } = await sb
    .from('site_intervenants')
    .select('id, site_id, role, company_id, main_contact_id, created_at')
    .eq('site_id', siteId)
    .is('effective_to', null) // casting COURANT (l'historique vit dans les lignes clôturées)
    .order('created_at', { ascending: true })
  const list = rows ?? []
  if (list.length === 0) return []

  const companyIds = [...new Set(list.map((r) => r.company_id as string))]
  const contactIds = list.map((r) => r.main_contact_id as string | null).filter((x): x is string => !!x)

  const { data: companies } = await sb.from('companies').select('id, name, short_name').in('id', companyIds)
  const companyById = new Map((companies ?? []).map((c) => [c.id as string, c]))
  const contactById = new Map<string, Record<string, unknown>>()
  if (contactIds.length > 0) {
    const { data: contacts } = await sb.from('company_contacts').select('id, full_name, function, phone, mobile, email').in('id', contactIds)
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
      contactFunction: (ct?.function as string | null) ?? null,
      contactPhone: (ct?.phone as string | null) ?? null,
      contactMobile: (ct?.mobile as string | null) ?? null,
      contactEmail: (ct?.email as string | null) ?? null,
    }
  })
}

/** Ouvre un lien rôle→entreprise (ACTIF). Si un lien actif identique existe, met à
 *  jour son contact ; sinon en crée un (effective_from = date du CR, source = le CR).
 *  Ne clôture PAS les autres entreprises du même rôle (co-traitance possible). */
export async function openSiteIntervenant(input: {
  siteId: string
  role: string
  companyId: string
  mainContactId?: string | null
  effectiveFrom?: string | null
  sourceReportId?: string | null
}): Promise<void> {
  const sb = createAdminClient()
  const role = input.role.trim().toUpperCase()
  const { data: existing } = await sb
    .from('site_intervenants')
    .select('id')
    .eq('site_id', input.siteId)
    .eq('role', role)
    .eq('company_id', input.companyId)
    .is('effective_to', null)
    .maybeSingle()
  if (existing?.id) {
    const { error } = await sb.from('site_intervenants').update({ main_contact_id: input.mainContactId ?? null }).eq('id', existing.id)
    if (error) throw new Error(error.message)
    return
  }
  const row: Record<string, unknown> = {
    site_id: input.siteId, role, company_id: input.companyId, main_contact_id: input.mainContactId ?? null,
    source_report_id: input.sourceReportId ?? null,
  }
  if (input.effectiveFrom) row.effective_from = input.effectiveFrom
  const { error } = await sb.from('site_intervenants').insert(row)
  if (error) throw new Error(error.message)
}

/** CLÔTURE un lien (effective_to = date) au lieu de le supprimer → l'historique du
 *  casting est préservé (« qui était ETV au CR05 »). */
export async function closeSiteIntervenant(siteId: string, id: string, effectiveTo: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_intervenants')
    .update({ effective_to: effectiveTo })
    .eq('id', id)
    .eq('site_id', siteId)
    .is('effective_to', null)
  if (error) throw new Error(error.message)
}

export interface SiteContactOption {
  id: string
  fullName: string
  function: string | null
  phone: string | null
  mobile: string | null
  email: string | null
  companyName: string
}

/** Tous les contacts des entreprises ACTIVES du casting d'un site — pour relier un
 *  participant ou un décisionnaire à une vraie personne (« Jean Dupont — BatiSud »). */
export async function listSiteContacts(siteId: string): Promise<SiteContactOption[]> {
  const sb = createAdminClient()
  const intervenants = await listSiteIntervenants(siteId)
  const companyIds = [...new Set(intervenants.map((i) => i.companyId))]
  if (companyIds.length === 0) return []
  const { data: companies } = await sb.from('companies').select('id, name, short_name').in('id', companyIds)
  const nameById = new Map((companies ?? []).map((c) => [c.id as string, (c.short_name as string | null) || (c.name as string)]))
  const { data: contacts } = await sb
    .from('company_contacts')
    .select('id, company_id, full_name, function, phone, mobile, email')
    .in('company_id', companyIds)
    .is('deleted_at', null)
    .order('full_name', { ascending: true })
  return (contacts ?? []).map((c) => ({
    id: c.id as string,
    fullName: (c.full_name as string) ?? '',
    function: (c.function as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    mobile: (c.mobile as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    companyName: nameById.get(c.company_id as string) ?? '',
  }))
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
