'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { requireOwned } from '@/lib/auth/ownership'
import { createAdminClient } from '@/lib/supabase/admin'
import { upsertPreparationItem, removePreparationItem } from '@/lib/db/visit-preparation'

const addSchema = z.object({
  site_id:               z.string().uuid(),
  stable_key:            z.string().min(1).max(200),
  label:                 z.string().min(1).max(500),
  source_kind:           z.enum(['auto_attention', 'auto_verify', 'auto_important', 'manual']),
  source_ref:            z.string().nullable().optional(),
  canonical_subject_id:  z.string().uuid().nullable().optional(),
  priority:              z.enum(['critical', 'important', 'normal']),
  reason:                z.string().nullable().optional(),
})

export async function addToPlanAction(
  input: z.input<typeof addSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = addSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const owned = await requireOwned(auth.role, 'sites', parsed.data.site_id)
  if (!owned.allowed) return { ok: false, error: owned.error }

  try {
    const supabase = createAdminClient()
    const { data: site } = await supabase
      .from('sites')
      .select('organization_id')
      .eq('id', parsed.data.site_id)
      .maybeSingle()
    if (!site) return { ok: false, error: 'Chantier introuvable' }

    await upsertPreparationItem({
      siteId: parsed.data.site_id,
      organizationId: site.organization_id,
      stableKey: parsed.data.stable_key,
      label: parsed.data.label,
      sourceKind: parsed.data.source_kind,
      sourceRef: parsed.data.source_ref ?? null,
      canonicalSubjectId: parsed.data.canonical_subject_id ?? null,
      priority: parsed.data.priority,
      reason: parsed.data.reason ?? null,
      preparedBy: auth.userId,
    })

    revalidatePath(`/m/site/${parsed.data.site_id}/prepare`)
    return { ok: true }
  } catch {
    return { ok: false, error: "Échec de l'ajout au plan" }
  }
}

const removeSchema = z.object({
  id:      z.string().uuid(),
  site_id: z.string().uuid(),
})

export async function removeFromPlanAction(
  input: z.input<typeof removeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = removeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  try {
    await removePreparationItem(parsed.data.id, auth.userId)
    revalidatePath(`/m/site/${parsed.data.site_id}/prepare`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la suppression du plan' }
  }
}
