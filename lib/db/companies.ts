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
}

const SELECT =
  'id, organization_id, name, short_name, logo_url, siret, address, postal_code, city, country, phone, email, website, notes'

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
