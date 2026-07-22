// ENTREPRISES intervenantes (mig 137) — organismes réutilisables dans tout l'org
// MemorIA (BatiSud, Médipôle…). Le RÔLE n'est pas ici (il vit dans site_intervenants).
import { createAdminClient } from '@/lib/supabase/admin'

export interface Company {
  id: string
  organizationId: string | null
  name: string
  shortName: string | null
  logoUrl: string | null
  siret: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  country: string | null
  phone: string | null
  email: string | null
  website: string | null
  notes: string | null
  /** Entreprise d'ATTENTE (« À identifier »), pas une société réelle (mig 232).
   *  À exclure des sélecteurs, des statistiques et de tout rapprochement
   *  d'identité — ses contacts ne sont pas des collègues. */
  isPlaceholder: boolean
}

const SELECT =
  'id, organization_id, name, short_name, logo_url, siret, address, postal_code, city, country, phone, email, website, notes, is_placeholder'

function rowToCompany(r: Record<string, unknown>): Company {
  return {
    id: r.id as string,
    organizationId: (r.organization_id as string | null) ?? null,
    name: (r.name as string) ?? '',
    shortName: (r.short_name as string | null) ?? null,
    logoUrl: (r.logo_url as string | null) ?? null,
    siret: (r.siret as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    postalCode: (r.postal_code as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    website: (r.website as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    isPlaceholder: (r.is_placeholder as boolean | null) ?? false,
  }
}

export async function listCompanies(orgId: string): Promise<Company[]> {
  const { data } = await createAdminClient()
    .from('companies')
    .select(SELECT)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
  return (data ?? []).map(rowToCompany)
}

export async function getCompany(id: string): Promise<Company | null> {
  const { data } = await createAdminClient().from('companies').select(SELECT).eq('id', id).maybeSingle()
  return data ? rowToCompany(data) : null
}

export interface CompanyInput {
  name: string
  shortName?: string | null
  logoUrl?: string | null
  siret?: string | null
  address?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  notes?: string | null
}

export async function createCompany(orgId: string, input: CompanyInput): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('companies')
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      short_name: input.shortName?.trim() || null,
      logo_url: input.logoUrl?.trim() || null,
      siret: input.siret?.trim() || null,
      address: input.address?.trim() || null,
      postal_code: input.postalCode?.trim() || null,
      city: input.city?.trim() || null,
      country: input.country?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      website: input.website?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

/** Trouve (insensible à la casse, dans l'org) ou crée une entreprise par son nom. */
export async function findOrCreateCompanyByName(orgId: string, name: string): Promise<string> {
  const clean = name.trim()
  if (!clean) throw new Error('Nom d’entreprise vide.')
  const { data } = await createAdminClient()
    .from('companies')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .ilike('name', clean)
    .limit(1)
    .maybeSingle()
  if (data?.id) return data.id as string
  return createCompany(orgId, { name: clean })
}

/** Trouve (insensible à la casse, dans l'entreprise) ou crée un contact par son
 *  nom. C'est ce helper qui permet à la confirmation de dire « personne » :
 *  sans lui, confirmer « Vincent Milon (PAVE) » créait une ENTREPRISE
 *  « Vincent Milon ». Dédoublonne par nom : le même « Jean Dupont » cité sur
 *  deux visites reste une seule personne.
 *
 *  `orgId` est REQUIS : depuis la mig 219, company_contacts.organization_id est
 *  NOT NULL et un trigger (check_company_contact_org) refuse tout contact sans
 *  org — l'isolation ne dépend plus de l'entreprise (elle est devenue
 *  optionnelle). Il doit correspondre à l'org de `companyId`. */
export async function findOrCreateCompanyContact(orgId: string, companyId: string, fullName: string): Promise<string> {
  const clean = fullName.trim()
  if (!clean) throw new Error('Nom de personne vide.')
  const db = createAdminClient()
  const { data } = await db
    .from('company_contacts')
    .select('id')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .ilike('full_name', clean)
    .limit(1)
    .maybeSingle()
  if (data?.id) return data.id as string
  const { data: ins, error } = await db
    .from('company_contacts')
    .insert({ organization_id: orgId, company_id: companyId, full_name: clean })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return ins.id as string
}

export async function updateCompany(orgId: string, id: string, patch: Partial<CompanyInput>): Promise<void> {
  const row: Record<string, unknown> = {}
  const m: Record<keyof CompanyInput, string> = {
    name: 'name', shortName: 'short_name', logoUrl: 'logo_url', siret: 'siret', address: 'address',
    postalCode: 'postal_code', city: 'city', country: 'country', phone: 'phone', email: 'email',
    website: 'website', notes: 'notes',
  }
  for (const k of Object.keys(patch) as (keyof CompanyInput)[]) {
    const v = patch[k]
    row[m[k]] = typeof v === 'string' ? v.trim() || null : v ?? null
  }
  if (Object.keys(row).length === 0) return
  const { error } = await createAdminClient().from('companies').update(row).eq('id', id).eq('organization_id', orgId)
  if (error) throw new Error(error.message)
}

// ── L'ENTREPRISE D'ATTENTE (mig 232) ───────────────────────────────────────
//
// Sur un chantier, on croise quelqu'un avant de savoir pour qui il travaille.
// Le schéma l'interdisait : tout contact vit sous une entreprise (mig 137).
// Plutôt que de refuser — donc d'exiger une information que le terrain n'a pas
// encore — on rattache la personne à une entreprise d'ATTENTE, une par
// organisation, reconnaissable par son drapeau et non par son nom.
//
// CE N'EST PAS UNE SOCIÉTÉ. Elle ne doit apparaître ni dans les sélecteurs, ni
// dans les statistiques, et surtout jamais comme entreprise commune dans un
// rapprochement d'identité : ses contacts ne sont pas des collègues.

/** Le libellé montré à l'humain. Le CODE, lui, ne s'y fie jamais : il lit
 *  `is_placeholder`. Un nom se traduit et se corrige ; un drapeau non. */
export const ENTREPRISE_A_IDENTIFIER = 'À identifier'

/**
 * L'entreprise d'attente de cette organisation, créée à la première demande.
 *
 * L'index unique partiel (mig 232) garantit qu'il n'en existe qu'une : deux
 * appels concurrents ne peuvent pas en fabriquer deux. En cas de collision, on
 * relit plutôt que d'échouer — la course est gagnée par l'autre, pas perdue
 * par nous.
 */
export async function findOrCreatePlaceholderCompany(orgId: string): Promise<string> {
  const db = createAdminClient()
  const lire = async () => {
    const { data } = await db
      .from('companies')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_placeholder', true)
      .is('deleted_at', null)
      .maybeSingle()
    return (data?.id as string | undefined) ?? null
  }

  const existant = await lire()
  if (existant) return existant

  const { data, error } = await db
    .from('companies')
    .insert({ organization_id: orgId, name: ENTREPRISE_A_IDENTIFIER, is_placeholder: true })
    .select('id')
    .single()
  if (!error && data?.id) return data.id as string

  // Course perdue contre un appel concurrent : l'index a fait son travail.
  const apres = await lire()
  if (apres) return apres
  throw new Error(error?.message ?? 'Entreprise d’attente introuvable')
}
