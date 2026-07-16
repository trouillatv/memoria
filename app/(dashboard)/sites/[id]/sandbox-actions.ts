'use server'

// Réinitialisation du chantier de recette — la SEULE suppression en masse du produit.
// Trois verrous, dans cet ordre : rôle, organisation de l'appelant, drapeau
// `is_sandbox` relu en base. Le drapeau n'est jamais un paramètre : personne ne peut
// prétendre qu'un chantier client est un bac à sable.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById, getOrgId } from '@/lib/db/users'
import { resetSandboxSite, type SandboxResetResult } from '@/lib/db/sandbox'

const schema = z.object({ site_id: z.string().uuid() })

export async function resetSandboxSiteAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true; deleted: SandboxResetResult } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non autorisé' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { ok: false, error: 'Non autorisé' }

  const orgId = await getOrgId()
  const deleted = await resetSandboxSite(parsed.data.site_id, orgId)
  // null = pas un bac à sable de cette organisation. On ne dit pas pourquoi : rien
  // n'a été supprimé, c'est la seule chose qui compte.
  if (!deleted) return { ok: false, error: "Ce chantier n'est pas un chantier de recette." }

  revalidatePath(`/sites/${parsed.data.site_id}`)
  revalidatePath('/dashboard')
  return { ok: true, deleted }
}
