'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { clearMustChangePasswordForCurrentUser } from '@/lib/db/users'

const schema = z.object({
  password: z.string().min(8, 'Min 8 caractères'),
})

export async function changePasswordAction(formData: FormData) {
  const parsed = schema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  await clearMustChangePasswordForCurrentUser()

  // Efface aussi le flag dans app_metadata pour que le middleware (qui lit le JWT)
  // ne renvoie plus l'utilisateur sur /change-password.
  const admin = createAdminClient()
  const { data: existing } = await admin.auth.admin.getUserById(user.id)
  if (existing.user) {
    const cleanMeta = { ...(existing.user.app_metadata ?? {}) }
    delete cleanMeta.must_change_password
    await admin.auth.admin.updateUserById(user.id, { app_metadata: cleanMeta })
  }

  // Force un refresh de session côté client pour récupérer le nouveau JWT
  // sans must_change_password.
  await supabase.auth.refreshSession()

  redirect('/missions')
}
