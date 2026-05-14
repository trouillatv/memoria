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

  // Efface le flag dans app_metadata pour que le middleware (qui lit le JWT)
  // ne renvoie plus l'utilisateur sur /change-password.
  //
  // ⚠️ Supabase Admin API : updateUserById fait un MERGE sur app_metadata,
  // pas un REPLACE. Supprimer la clé de l'objet (`delete cleanMeta.x`) ne
  // fonctionne pas — Supabase garde l'ancienne valeur. Il faut explicitement
  // set la clé à `false` (ou `null`) pour la "neutraliser".
  // Le proxy middleware check `=== true`, donc false suffit.
  const admin = createAdminClient()
  await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { must_change_password: false },
  })

  // V5.1 fix : refreshSession côté serveur ne propage pas toujours le nouveau
  // JWT au cookie avant le redirect, ce qui cause une boucle (proxy middleware
  // lit l'ancien JWT avec must_change_password=true). On force un signOut puis
  // redirect vers login — l'user retape son nouveau mdp pour confirmer, et le
  // login génère un JWT propre. UX un peu plus longue mais déterministe.
  await supabase.auth.signOut()
  redirect('/login?password_changed=1')
}
