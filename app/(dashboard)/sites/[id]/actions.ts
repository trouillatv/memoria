'use server'

// Actions « À savoir » sur la fiche site (Phase 3.2).
//
// kind = 'note' (descriptif passé) ou 'a_savoir' (info utile à l'arrivée).
// active_until optionnel sur a_savoir uniquement. Doctrine V5 :
// descriptif du lieu, jamais directif envers les personnes.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { createSiteNote, softDeleteSiteNote } from '@/lib/db/sites'

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id }
}

const createSchema = z.object({
  site_id: z.string().uuid(),
  body: z.string().min(3).max(140),
  kind: z.enum(['note', 'a_savoir']),
  active_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

export async function createSiteASavoirAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

  const kindRaw = formData.get('kind')
  const activeUntilRaw = formData.get('active_until') as string | null
  const parsed = createSchema.safeParse({
    site_id: formData.get('site_id'),
    body: formData.get('body'),
    kind: kindRaw,
    active_until: activeUntilRaw && activeUntilRaw !== '' ? activeUntilRaw : null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  try {
    await createSiteNote({
      siteId: parsed.data.site_id,
      body: parsed.data.body,
      kind: parsed.data.kind,
      activeUntil: parsed.data.active_until ?? null,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Création échouée' }
  }

  revalidatePath(`/sites/${parsed.data.site_id}`)
  return { ok: true as const }
}

const deleteSchema = z.object({ note_id: z.string().uuid(), site_id: z.string().uuid() })

export async function deleteSiteASavoirAction(formData: FormData) {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth
  const parsed = deleteSchema.safeParse({
    note_id: formData.get('note_id'),
    site_id: formData.get('site_id'),
  })
  if (!parsed.success) return { error: 'Invalid' }

  try {
    await softDeleteSiteNote(parsed.data.note_id)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Suppression échouée' }
  }

  revalidatePath(`/sites/${parsed.data.site_id}`)
  return { ok: true as const }
}
