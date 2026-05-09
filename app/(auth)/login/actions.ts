'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

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
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('must_change_password, role')
      .eq('id', user.id)
      .single()

    if (profile?.must_change_password) {
      redirect('/change-password')
    }

    // Redirect par rôle (au Plan 1 tout le monde va sur /missions)
    redirect(parsed.data.next ?? '/missions')
  }

  redirect('/missions')
}
