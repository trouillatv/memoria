'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createGlossaryTerm, deleteGlossaryTerm, seedDefaultGlossary } from '@/lib/db/glossary'

const TermSchema = z.object({
  term: z.string().trim().min(1, 'Terme requis').max(120),
  definition: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(40).optional(),
  aliases: z.string().trim().max(500).optional(), // saisie « a, b, c »
})

// Admin uniquement (Vincent 2026-06-24) — le glossaire passe sous Admin.
async function requireAdmin() {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false as const, error: 'Non authentifié' }
  if (user.role !== 'admin') return { ok: false as const, error: 'Accès refusé' }
  return { ok: true as const, user }
}

export async function createGlossaryTermAction(
  input: z.infer<typeof TermSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  const parsed = TermSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const aliases = (parsed.data.aliases ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 20)

  try {
    await createGlossaryTerm({
      term: parsed.data.term,
      definition: parsed.data.definition || null,
      category: parsed.data.category || null,
      aliases,
      createdBy: auth.user.id,
    })
    revalidatePath('/glossaire')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

/** Charge le vocabulaire de démarrage (BTP/VRD + MOE). Idempotent. Admin only. */
export async function loadDefaultGlossaryAction(): Promise<{ ok: boolean; inserted?: number; error?: string }> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  try {
    const r = await seedDefaultGlossary(auth.user.id)
    revalidatePath('/glossaire')
    return { ok: true, inserted: r.inserted }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

export async function deleteGlossaryTermAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Identifiant invalide' }
  try {
    await deleteGlossaryTerm(id)
    revalidatePath('/glossaire')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}
