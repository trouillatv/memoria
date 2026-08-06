'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCurrentUserMiniProfile } from '@/lib/db/users'
import { resolveHomeDestination } from '@/lib/navigation/home'

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

    // next doit être une URL relative interne (prévenir open redirect)
    const safeNext = parsed.data.next?.startsWith('/') ? parsed.data.next : undefined
    redirect(safeNext ?? resolveHomeDestination(profile.role))
  }

  redirect('/dashboard')
}
