'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCurrentUserMiniProfile } from '@/lib/db/users'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  next: z.string().optional(),
})

export async function loginAction(formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  })
  if (!parsed.success) {
    return { error: 'Email ou mot de passe invalide.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    return { error: 'Identifiants incorrects.' }
  }

  // Vérifier must_change_password
  const profile = await getCurrentUserMiniProfile()
  if (profile) {
    if (profile.must_change_password) {
      redirect('/change-password')
    }

    // Redirect par rôle :
    // - chef_equipe (agent terrain) → /m (route mobile bornée, Slice 3.0)
    // - admin / manager → /missions (ou ?next= si fourni)
    if (profile.role === 'chef_equipe') {
      redirect('/m')
    }

    redirect(parsed.data.next ?? '/missions')
  }

  redirect('/missions')
}
