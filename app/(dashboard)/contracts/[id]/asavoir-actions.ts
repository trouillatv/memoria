'use server'

// Matérialisation d'une proposition « à savoir » (Atelier IA v2, Phase 2).
// Vincent 2026-05-25. L'humain pousse une proposition site-scopée vers un site
// réel du contrat → crée un vrai site_note « à savoir » (lien terrain), qui
// nourrit le moteur de signaux (fresh_field_memory). L'IA propose, l'humain crée.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { createSiteNote } from '@/lib/db/sites'

const schema = z.object({
  engagement_id: z.string().uuid(),
  site_id: z.string().uuid(),
  contract_id: z.string().uuid(),
})

export async function materializeASavoirAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Accès refusé' }

  const parsed = schema.safeParse({
    engagement_id: formData.get('engagement_id'),
    site_id: formData.get('site_id'),
    contract_id: formData.get('contract_id'),
  })
  if (!parsed.success) return { ok: false, error: 'Champs invalides' }

  const admin = createAdminClient()
  const { data: eng } = await admin
    .from('engagements')
    .select('id, short_label, destination, source_ref')
    .eq('id', parsed.data.engagement_id)
    .maybeSingle()
  if (!eng) return { ok: false, error: 'Proposition introuvable' }
  if (eng.destination !== 'a_savoir') return { ok: false, error: 'Pas une proposition « à savoir »' }
  const ref = (eng.source_ref ?? {}) as Record<string, unknown>
  if (ref.materialized_at) return { ok: false, error: 'Déjà ajouté à un site' }

  // Crée le « à savoir » sur le site (3-140 car. ; short_label ≤ 100 → OK).
  try {
    await createSiteNote({ siteId: parsed.data.site_id, body: eng.short_label, kind: 'a_savoir' })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Création échouée' }
  }

  // Marque la proposition comme matérialisée (sans toucher au statut).
  await admin
    .from('engagements')
    .update({ source_ref: { ...ref, materialized_at: new Date().toISOString(), materialized_site_id: parsed.data.site_id } })
    .eq('id', parsed.data.engagement_id)

  revalidatePath(`/contracts/${parsed.data.contract_id}`)
  return { ok: true }
}
