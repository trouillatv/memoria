'use server'

// Sprint 2 — Mémoire des lieux : server action pour ajouter une note courte
// depuis la page intervention mobile.
//
// Doctrine V5 :
//   - Pilier 5 (agent oubliable) : 2 taps total (+ ouvrir, + ajouter).
//   - Verrou V4 : pas de wording de contrôle côté UI ; côté backend, validation
//     uniquement de longueur, jamais du lexique de l'humain.
//   - Verrou V5 : édition contrainte 3-140 chars.
//
// L'auth est ouverte aux 3 rôles : chef_equipe (Joseph), admin, manager. La
// note est descriptive, pas une commande. Le created_by est récupéré dans
// createSiteNote depuis le contexte auth (cohérent avec la policy INSERT qui
// exige created_by = auth.uid()).

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { createSiteNote } from '@/lib/db/sites'

const Schema = z.object({
  siteId: z.string().uuid(),
  body: z.string().trim().min(3, 'Note trop courte (3 caractères minimum)').max(140, 'Note trop longue (140 caractères maximum)'),
})

export async function addSiteNoteAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Auth — chef_equipe ET admin/manager autorisés (la note est utile pour tout
  // le monde sur le terrain ; pas de hiérarchie sur ce point).
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const role = await getUserRoleById(user.id)
  if (role !== 'chef_equipe' && role !== 'admin' && role !== 'manager') {
    return { ok: false, error: 'Forbidden' }
  }

  const parsed = Schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }

  try {
    await createSiteNote({ siteId: parsed.data.siteId, body: parsed.data.body, kind: 'a_savoir' })
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Création échouée',
    }
  }

  // Revalider les pages /m/intervention/* — pas d'id ici sans contexte, on
  // revalide à la fois /m et /m/intervention. Le caller passe par router.refresh()
  // côté client pour mise à jour immédiate.
  revalidatePath('/m', 'layout')
  return { ok: true }
}
