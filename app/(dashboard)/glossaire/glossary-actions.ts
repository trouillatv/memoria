'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { createGlossaryTerm, deleteGlossaryTerm, seedDefaultGlossary } from '@/lib/db/glossary'

const TermSchema = z.object({
  term: z.string().trim().min(1, 'Terme requis').max(120),
  definition: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(40).optional(),
  aliases: z.string().trim().max(500).optional(), // saisie « a, b, c »
  organization_id: z.string().uuid().optional(),
})

// Helper partagé : résout l'org de l'utilisateur courant.
async function resolveOrgId(
  explicitId?: string,
): Promise<{ organizationId: string } | { ok: false; error: string }> {
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return { ok: false, error: 'Aucune organisation active' }
  if (orgIds.length === 1) return { organizationId: orgIds[0] }
  if (!explicitId || !orgIds.includes(explicitId)) {
    return { ok: false, error: 'Sélectionnez une organisation' }
  }
  return { organizationId: explicitId }
}

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

  const orgRes = await resolveOrgId(parsed.data.organization_id)
  if ('ok' in orgRes) return orgRes

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
      organization_id: orgRes.organizationId,
    })
    revalidatePath('/glossaire')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

/** Charge le vocabulaire de démarrage (BTP/VRD + MOE). Idempotent. Admin only. */
export async function loadDefaultGlossaryAction(
  input?: { organization_id?: string },
): Promise<{ ok: boolean; inserted?: number; error?: string }> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth
  const orgRes = await resolveOrgId(input?.organization_id)
  if ('ok' in orgRes) return orgRes
  try {
    const r = await seedDefaultGlossary(auth.user.id, orgRes.organizationId)
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
