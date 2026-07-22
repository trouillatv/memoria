'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { createSite, updateSite } from '@/lib/db/sites'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

// Champs structurés "fiche site" — migration 036. Tous facultatifs, max 500
// chars (200 pour les codes courts), pour rester opérationnel sans devenir CMS.
const siteFieldsSchema = {
  access_code: z.string().max(200).optional(),
  alarm_code: z.string().max(200).optional(),
  contact_name: z.string().max(200).optional(),
  contact_phone: z.string().max(50).optional(),
  access_hours: z.string().max(200).optional(),
  access_instructions: z.string().max(1000).optional(),
}

const createSiteSchema = z.object({
  contract_id: z.string().uuid(),
  client_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  ...siteFieldsSchema,
})

function pickSiteFields(formData: FormData) {
  return {
    access_code: formData.get('access_code') || undefined,
    alarm_code: formData.get('alarm_code') || undefined,
    contact_name: formData.get('contact_name') || undefined,
    contact_phone: formData.get('contact_phone') || undefined,
    access_hours: formData.get('access_hours') || undefined,
    access_instructions: formData.get('access_instructions') || undefined,
  }
}

/**
 * Find or create a "client" record matching the contract's client_name.
 * The Phase 1 contracts have client_name (text) but no FK to clients.
 * For Phase 2 sites, we need a real clients.id — so we lookup-or-create.
 */
async function ensureClientForContract(contractId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data: contract } = await supabase
    .from('contracts')
    .select('client_name, organization_id')
    .eq('id', contractId)
    .maybeSingle()
  if (!contract) throw new Error('Contract not found')
  const membership = await requireOrganizationMembership(contract.organization_id)
  if (!membership.ok) throw new Error(membership.error)
  const orgId = contract.organization_id

  // Try to find existing (scoped to org)
  let qExisting = supabase
    .from('clients')
    .select('id')
    .eq('name', contract.client_name)
    .is('deleted_at', null)
  if (orgId) qExisting = qExisting.eq('organization_id', orgId)
  const { data: existing } = await qExisting.maybeSingle()
  if (existing) return existing.id

  // Create
  const { data, error } = await supabase
    .from('clients')
    .insert({ name: contract.client_name, ...(orgId ? { organization_id: orgId } : {}) })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function createSiteAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = createSiteSchema.safeParse({
    contract_id: formData.get('contract_id'),
    client_id: formData.get('client_id'),
    name: formData.get('name'),
    address: formData.get('address') || undefined,
    notes: formData.get('notes') || undefined,
    ...pickSiteFields(formData),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  // Resolve client_id — UI may pass placeholder, we ensure consistency
  const clientId = await ensureClientForContract(parsed.data.contract_id)

  const siteId = await createSite({
    client_id: clientId,
    contract_id: parsed.data.contract_id,
    name: parsed.data.name,
    address: parsed.data.address ?? null,
    notes: parsed.data.notes ?? null,
    access_code: parsed.data.access_code ?? null,
    alarm_code: parsed.data.alarm_code ?? null,
    contact_name: parsed.data.contact_name ?? null,
    contact_phone: parsed.data.contact_phone ?? null,
    access_hours: parsed.data.access_hours ?? null,
    access_instructions: parsed.data.access_instructions ?? null,
  })

  revalidatePath(`/contracts/${parsed.data.contract_id}/sites`)
  revalidatePath(`/contracts/${parsed.data.contract_id}`)
  // Règle d'or (lot R) : le site (et son client, créé au besoin par
  // ensureClientForContract) apparaît aussi dans les listes globales.
  revalidatePath('/sites')
  revalidatePath('/clients')
  return { ok: true as const, siteId }
}

const updateSiteSchema = z.object({
  contract_id: z.string().uuid(),
  site_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  ...siteFieldsSchema,
})

export async function updateSiteAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = updateSiteSchema.safeParse({
    contract_id: formData.get('contract_id'),
    site_id: formData.get('site_id'),
    name: formData.get('name'),
    address: formData.get('address') || undefined,
    notes: formData.get('notes') || undefined,
    ...pickSiteFields(formData),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  await updateSite(parsed.data.site_id, {
    name: parsed.data.name,
    address: parsed.data.address ?? null,
    notes: parsed.data.notes ?? null,
    access_code: parsed.data.access_code ?? null,
    alarm_code: parsed.data.alarm_code ?? null,
    contact_name: parsed.data.contact_name ?? null,
    contact_phone: parsed.data.contact_phone ?? null,
    access_hours: parsed.data.access_hours ?? null,
    access_instructions: parsed.data.access_instructions ?? null,
  })

  revalidatePath(`/contracts/${parsed.data.contract_id}/sites`)
  revalidatePath(`/contracts/${parsed.data.contract_id}`)
  return { ok: true as const }
}
