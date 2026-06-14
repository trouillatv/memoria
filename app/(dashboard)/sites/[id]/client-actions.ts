'use server'

// client-actions.ts — Server actions pour la gestion du client associé à un site.
// Tâche 2 : créer un client et l'associer à un site sans client_id.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById, getOrgId } from '@/lib/db/users'

// ── Garde d'accès ────────────────────────────────────────────────────────────

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Accès interdit' }
  return { userId: user.id }
}

// ── Schéma de validation ─────────────────────────────────────────────────────

const createClientSchema = z.object({
  name: z.string().min(2, 'Le nom est requis (2 caractères minimum)').max(200),
  contactName: z.string().max(200).nullable(),
  email: z.union([z.string().email('Email invalide'), z.literal(''), z.null()]),
  phone: z.string().max(50).nullable(),
})

// ── Action principale ─────────────────────────────────────────────────────────

/**
 * Crée un client et l'associe immédiatement au site donné.
 * Réservé aux managers et admins.
 * Retourne { ok: true, clientId } ou { error: string }.
 */
export async function createClientForSiteAction(
  siteId: string,
  payload: {
    name: string
    contactName: string | null
    email: string | null
    phone: string | null
  },
): Promise<{ ok: true; clientId: string } | { error: string }> {
  // 1. Vérifier l'auth
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  // 2. Valider siteId
  const siteIdResult = z.string().uuid('ID de site invalide').safeParse(siteId)
  if (!siteIdResult.success) return { error: 'ID de site invalide' }

  // 3. Valider le payload
  const parsed = createClientSchema.safeParse(payload)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }

  const supabase = createAdminClient()
  const orgId = await getOrgId()

  // 4. Vérifier que le site n'a pas déjà un client
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id, client_id')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()

  if (siteErr || !site) return { error: 'Site introuvable' }
  if (site.client_id) return { error: 'Ce site a déjà un client associé' }

  // 5. Créer le client
  const insertPayload: {
    name: string
    contact_name: string | null
    contact_email: string | null
    contact_phone: string | null
    organization_id: string | null
  } = {
    name: parsed.data.name,
    contact_name: parsed.data.contactName,
    contact_email: parsed.data.email || null,
    contact_phone: parsed.data.phone,
    organization_id: orgId,
  }

  const { data: newClient, error: insertErr } = await supabase
    .from('clients')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insertErr || !newClient) {
    return { error: insertErr?.message ?? 'Création du client échouée' }
  }

  const clientId = (newClient as { id: string }).id

  // 6. Associer le client au site
  const { error: updateErr } = await supabase
    .from('sites')
    .update({ client_id: clientId })
    .eq('id', siteId)

  if (updateErr) {
    return { error: updateErr.message ?? 'Association au site échouée' }
  }

  revalidatePath(`/sites/${siteId}`)
  return { ok: true, clientId }
}
