'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

interface UpdateProfileInput {
  full_name: string
  // Sprint 4 PC — Téléphone WhatsApp (Maxim 9 : 1-à-1, jamais groupe).
  // null/undefined = pas modifié. Chaîne vide = suppression. Format E.164 attendu.
  phone?: string | null
}

/** Validation E.164 stricte : +<7-15 chiffres>. */
const E164_REGEX = /^\+[0-9]{7,15}$/

interface ChangePasswordInput {
  current_password: string
  new_password: string
}

export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<{ ok: boolean; error?: string }> {
  const fullName = input.full_name?.trim()
  if (!fullName || fullName.length < 2) {
    return { ok: false, error: 'Le nom doit contenir au moins 2 caractères.' }
  }
  if (fullName.length > 100) {
    return { ok: false, error: 'Le nom est trop long.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) {
    return { ok: false, error: 'Vous devez être connecté.' }
  }

  // Téléphone optionnel — normalise puis valide format E.164.
  // - undefined : pas de changement
  // - '' : suppression du numéro
  // - sinon : doit matcher +[7-15 chiffres]
  const patch: Record<string, unknown> = { full_name: fullName }
  if (input.phone !== undefined) {
    const phoneRaw = (input.phone ?? '').trim()
    if (phoneRaw === '') {
      patch.phone = null
    } else {
      // Tolère espaces/tirets en entrée et normalise.
      const normalized = phoneRaw.replace(/[\s.\-_]/g, '')
      if (!E164_REGEX.test(normalized)) {
        return {
          ok: false,
          error: "Le numéro doit être au format international (ex : +687123456).",
        }
      }
      patch.phone = normalized
    }
  }

  const { error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', user.id)

  if (error) {
    return { ok: false, error: 'Impossible de mettre à jour votre profil.' }
  }

  revalidatePath('/account')
  // Rafraîchit le sidebar / topbar qui affichent le full_name.
  revalidatePath('/', 'layout')
  return { ok: true }
}

const PERSISTABLE_THEMES = ['light', 'dark', 'ocre', 'petrole', 'archive', 'monolithe'] as const

/**
 * Persiste le thème UI préféré de l'utilisateur (réappliqué au login,
 * cross-device). Best-effort : silencieux si non connecté / thème inconnu.
 * Pas de revalidate (le thème est déjà appliqué côté client par next-themes).
 */
export async function updateThemePreferenceAction(theme: string): Promise<{ ok: boolean }> {
  if (!(PERSISTABLE_THEMES as readonly string[]).includes(theme)) return { ok: false }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const { error } = await supabase
    .from('users')
    .update({ theme_preference: theme })
    .eq('id', user.id)
  return { ok: !error }
}

export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<{ ok: boolean; error?: string }> {
  const { current_password, new_password } = input

  if (!current_password || !new_password) {
    return { ok: false, error: 'Tous les champs sont requis.' }
  }
  if (new_password.length < 8) {
    return { ok: false, error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' }
  }
  if (new_password === current_password) {
    return { ok: false, error: "Le nouveau mot de passe doit être différent de l'ancien." }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user?.email) {
    return { ok: false, error: 'Vous devez être connecté.' }
  }

  // Vérifie le mot de passe actuel via un signin éphémère.
  // Note : ceci renouvelle la session avec les mêmes credentials,
  // c'est volontaire et sans effet de bord pour l'utilisateur.
  const { error: signinErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current_password,
  })
  if (signinErr) {
    return { ok: false, error: 'Mot de passe actuel incorrect.' }
  }

  const { error: updateErr } = await supabase.auth.updateUser({
    password: new_password,
  })
  if (updateErr) {
    return { ok: false, error: 'Impossible de modifier le mot de passe. Réessayez.' }
  }

  // Si l'utilisateur avait must_change_password, le clear (best effort).
  await supabase
    .from('users')
    .update({ must_change_password: false })
    .eq('id', user.id)

  return { ok: true }
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
