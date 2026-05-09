'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const schema = z.object({
  password: z.string().min(8, 'Mot de passe trop court (min 8 caractères)'),
})

export async function acceptInviteAction(formData: FormData) {
  const parsed = schema.safeParse({ password: formData.get('password') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  // Marquer must_change_password = false
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('users').update({ must_change_password: false }).eq('id', user.id)
  }

  redirect('/missions')
}
