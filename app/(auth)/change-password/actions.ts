'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { clearMustChangePasswordForCurrentUser } from '@/lib/db/users'

const schema = z.object({
  password: z.string().min(8, 'Min 8 caractères'),
})

export async function changePasswordAction(formData: FormData) {
  const parsed = schema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  await clearMustChangePasswordForCurrentUser()
  redirect('/missions')
}
