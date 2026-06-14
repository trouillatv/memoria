'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'

const Schema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(200),
  contactName: z.string().trim().max(200).optional(),
  email: z.string().trim().email('Email invalide').max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(50).optional(),
})

export async function createClientAction(
  raw: { name: string; contactName?: string; email?: string; phone?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') {
    return { ok: false, error: 'Action non autorisée' }
  }

  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }

  const orgId = user.organization_id
  if (!orgId) return { ok: false, error: 'Organisation introuvable' }

  const supabase = createAdminClient()

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      name: parsed.data.name,
      contact_name: parsed.data.contactName || null,
      contact_email: parsed.data.email || null,
      contact_phone: parsed.data.phone || null,
      organization_id: orgId,
    })
    .select('id')
    .single()

  if (error || !client) {
    return { ok: false, error: 'Erreur lors de la création du client' }
  }

  revalidatePath('/clients')
  return { ok: true, id: (client as { id: string }).id }
}
