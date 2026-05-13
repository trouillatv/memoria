'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
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

const createSiteSchema = z.object({
  contract_id: z.string().uuid(),
  client_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
})

/**
 * Find or create a "client" record matching the contract's client_name.
 * The Phase 1 contracts have client_name (text) but no FK to clients.
 * For Phase 2 sites, we need a real clients.id — so we lookup-or-create.
 */
async function ensureClientForContract(contractId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data: contract } = await supabase
    .from('contracts')
    .select('client_name')
    .eq('id', contractId)
    .maybeSingle()
  if (!contract) throw new Error('Contract not found')

  // Try to find existing
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('name', contract.client_name)
    .is('deleted_at', null)
    .maybeSingle()
  if (existing) return existing.id

  // Create
  const { data, error } = await supabase
    .from('clients')
    .insert({ name: contract.client_name })
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
  })

  revalidatePath(`/contracts/${parsed.data.contract_id}/sites`)
  revalidatePath(`/contracts/${parsed.data.contract_id}`)
  return { ok: true as const, siteId }
}

const updateSiteSchema = z.object({
  contract_id: z.string().uuid(),
  site_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
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
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  await updateSite(parsed.data.site_id, {
    name: parsed.data.name,
    address: parsed.data.address ?? null,
    notes: parsed.data.notes ?? null,
  })

  revalidatePath(`/contracts/${parsed.data.contract_id}/sites`)
  revalidatePath(`/contracts/${parsed.data.contract_id}`)
  return { ok: true as const }
}
