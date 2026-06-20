// CONTACTS d'une entreprise (mig 137) — les personnes (Jean Dupont @ BatiSud).
// is_main = contact principal de l'entreprise (un seul par entreprise, idéalement).
import { createAdminClient } from '@/lib/supabase/admin'

export interface CompanyContact {
  id: string
  companyId: string
  fullName: string
  function: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  isMain: boolean
}

const SELECT = 'id, company_id, full_name, function, email, phone, mobile, is_main'

function rowToContact(r: Record<string, unknown>): CompanyContact {
  return {
    id: r.id as string,
    companyId: r.company_id as string,
    fullName: (r.full_name as string) ?? '',
    function: (r.function as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    mobile: (r.mobile as string | null) ?? null,
    isMain: Boolean(r.is_main),
  }
}

export async function listContactsByCompany(companyId: string): Promise<CompanyContact[]> {
  const { data } = await createAdminClient()
    .from('company_contacts')
    .select(SELECT)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .order('is_main', { ascending: false })
    .order('full_name', { ascending: true })
  return (data ?? []).map(rowToContact)
}

export interface ContactInput {
  fullName: string
  function?: string | null
  email?: string | null
  phone?: string | null
  mobile?: string | null
  isMain?: boolean
}

export async function createContact(companyId: string, input: ContactInput): Promise<string> {
  const sb = createAdminClient()
  // Un seul contact principal par entreprise : si on en désigne un, on dégrade les autres.
  if (input.isMain) await sb.from('company_contacts').update({ is_main: false }).eq('company_id', companyId)
  const { data, error } = await sb
    .from('company_contacts')
    .insert({
      company_id: companyId,
      full_name: input.fullName.trim(),
      function: input.function?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      mobile: input.mobile?.trim() || null,
      is_main: input.isMain ?? false,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}
