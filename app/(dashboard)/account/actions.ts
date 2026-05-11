'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

interface UpdateProfileInput {
  full_name: string
}

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

  const { error } = await supabase
    .from('users')
    .update({ full_name: fullName })
    .eq('id', user.id)

  if (error) {
    return { ok: false, error: 'Impossible de mettre à jour votre nom.' }
  }

  revalidatePath('/account')
  // Rafraîchit le sidebar / topbar qui affichent le full_name.
  revalidatePath('/', 'layout')
  return { ok: true }
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
