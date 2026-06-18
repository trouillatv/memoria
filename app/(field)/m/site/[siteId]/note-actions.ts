'use server'

// Capture terrain — note courte sur un site (« Prendre une note »).
// Mémoire opérationnelle déposée sans friction depuis le mobile. Atterrit dans
// site_notes (3–140 car.), déjà indexée pour la recherche mémoire. Le rangement
// par sous-périmètre se fera plus tard (IA propose / humain valide), jamais ici.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'

const schema = z.object({
  siteId: z.string().uuid(),
  body: z.string().trim().min(3, '3 caractères minimum').max(140, '140 caractères max'),
})

export async function addSiteNoteAction(input: {
  siteId: string
  body: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  // Terrain + bureau peuvent déposer (chef_equipe inclus).
  if (!['admin', 'manager', 'chef_equipe'].includes(user.role)) {
    return { ok: false, error: 'Accès refusé' }
  }

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Note invalide' }
  }

  const supabase = createAdminClient()
  // Garde-fou : le site doit appartenir à l'org de l'utilisateur.
  const { data: site } = await supabase
    .from('sites')
    .select('id, organization_id')
    .eq('id', parsed.data.siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site || (site as { organization_id: string }).organization_id !== user.organization_id) {
    return { ok: false, error: 'Chantier introuvable' }
  }

  const { error } = await supabase.from('site_notes').insert({
    site_id: parsed.data.siteId,
    body: parsed.data.body,
    created_by: user.id,
    organization_id: user.organization_id,
  })
  if (error) return { ok: false, error: 'Enregistrement impossible' }

  revalidatePath(`/m/site/${parsed.data.siteId}`)
  revalidatePath(`/sites/${parsed.data.siteId}`)
  return { ok: true }
}
