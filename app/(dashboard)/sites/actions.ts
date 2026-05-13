'use server'

// Server actions pour la page Sites globale (/sites).
// Doctrine : delete protégé — un site avec des données liées (missions,
// interventions, notes mémoire des lieux) ne peut JAMAIS être supprimé,
// seulement archivé via le soft-delete normal du site lui-même n'est
// possible que pour les sites sans aucune trace historique.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import {
  updateSite,
  softDeleteSite,
  getSiteDependencies,
} from '@/lib/db/sites'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

const updateSchema = z.object({
  site_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  access_code: z.string().max(200).optional(),
  alarm_code: z.string().max(200).optional(),
  contact_name: z.string().max(200).optional(),
  contact_phone: z.string().max(50).optional(),
  access_hours: z.string().max(200).optional(),
  access_instructions: z.string().max(1000).optional(),
})

export async function updateSiteGlobalAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = updateSchema.safeParse({
    site_id: formData.get('site_id'),
    name: formData.get('name'),
    address: formData.get('address') || undefined,
    notes: formData.get('notes') || undefined,
    access_code: formData.get('access_code') || undefined,
    alarm_code: formData.get('alarm_code') || undefined,
    contact_name: formData.get('contact_name') || undefined,
    contact_phone: formData.get('contact_phone') || undefined,
    access_hours: formData.get('access_hours') || undefined,
    access_instructions: formData.get('access_instructions') || undefined,
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

  revalidatePath('/sites')
  return { ok: true as const }
}

const deleteSchema = z.object({ site_id: z.string().uuid() })

/**
 * Supprime un site uniquement s'il n'a AUCUNE donnée liée (mission,
 * intervention, note). Sinon retourne un message explicatif qui guide
 * l'utilisateur vers l'archivage (= laisser le site, il bascule en
 * "Inactif" automatiquement après 6 mois sans intervention).
 */
export async function deleteSiteAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const parsed = deleteSchema.safeParse({ site_id: formData.get('site_id') })
  if (!parsed.success) return { error: 'Identifiant invalide' }

  const deps = await getSiteDependencies(parsed.data.site_id)
  const blockers: string[] = []
  if (deps.missionsCount > 0) {
    blockers.push(`${deps.missionsCount} mission${deps.missionsCount > 1 ? 's' : ''}`)
  }
  if (deps.interventionsCount > 0) {
    blockers.push(
      `${deps.interventionsCount} intervention${deps.interventionsCount > 1 ? 's' : ''}`,
    )
  }
  if (deps.siteNotesCount > 0) {
    blockers.push(
      `${deps.siteNotesCount} note${deps.siteNotesCount > 1 ? 's' : ''} de mémoire des lieux`,
    )
  }
  if (blockers.length > 0) {
    return {
      error:
        `Suppression impossible : ce site est lié à ${blockers.join(', ')}. ` +
        `L'historique doit être conservé. Le site basculera automatiquement en « Inactif » ` +
        `6 mois après sa dernière intervention.`,
    }
  }

  await softDeleteSite(parsed.data.site_id)
  revalidatePath('/sites')
  return { ok: true as const }
}
