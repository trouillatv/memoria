import 'server-only'

// ── Identité liée d'un canonical_subject acteur ───────────────────────────────
// Résout le lien contact_id / company_id (migration 299) vers l'identité réelle
// dans company_contacts / companies.
// Retourne null si le canonical_subject n'a pas de lien établi.

import { createAdminClient } from '@/lib/supabase/admin'

export type ActorLinkSource = 'auto' | 'llm' | 'manual'

export interface CompanyActorIdentity {
  kind: 'company'
  companyId: string
  name: string
  shortName: string | null
  phone: string | null
  email: string | null
  linkSource: ActorLinkSource
  linkValidatedAt: string | null
}

export interface PersonActorIdentity {
  kind: 'person'
  contactId: string
  fullName: string
  function: string | null
  phone: string | null
  mobile: string | null
  email: string | null
  companyId: string | null
  companyName: string | null
  linkSource: ActorLinkSource
  linkValidatedAt: string | null
}

export type ActorLinkedIdentity = CompanyActorIdentity | PersonActorIdentity

export async function getActorIdentity(canonicalSubjectId: string): Promise<ActorLinkedIdentity | null> {
  const sb = createAdminClient()

  const { data: cs } = await sb
    .from('canonical_subject')
    .select('company_id, contact_id, actor_link_source, actor_link_validated_at')
    .eq('id', canonicalSubjectId)
    .maybeSingle()

  if (!cs) return null
  const src = (cs.actor_link_source as ActorLinkSource | null) ?? 'auto'
  const validatedAt = cs.actor_link_validated_at as string | null

  if (cs.company_id) {
    const { data: company } = await sb
      .from('companies')
      .select('id, name, short_name, phone, email')
      .eq('id', cs.company_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!company) return null
    return {
      kind: 'company',
      companyId: company.id as string,
      name: company.name as string,
      shortName: company.short_name as string | null,
      phone: company.phone as string | null,
      email: company.email as string | null,
      linkSource: src,
      linkValidatedAt: validatedAt,
    }
  }

  if (cs.contact_id) {
    const { data: contact } = await sb
      .from('company_contacts')
      .select('id, full_name, function, phone, mobile, email, company_id')
      .eq('id', cs.contact_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!contact) return null

    let companyName: string | null = null
    if (contact.company_id) {
      const { data: comp } = await sb
        .from('companies')
        .select('name')
        .eq('id', contact.company_id)
        .is('deleted_at', null)
        .maybeSingle()
      companyName = (comp?.name as string | null) ?? null
    }

    return {
      kind: 'person',
      contactId: contact.id as string,
      fullName: contact.full_name as string,
      function: contact.function as string | null,
      phone: contact.phone as string | null,
      mobile: contact.mobile as string | null,
      email: contact.email as string | null,
      companyId: contact.company_id as string | null,
      companyName,
      linkSource: src,
      linkValidatedAt: validatedAt,
    }
  }

  return null
}
