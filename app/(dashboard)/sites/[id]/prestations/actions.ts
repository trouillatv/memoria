'use server'

// P0-3.1A — Porte B manuelle : ajouter un Engagement depuis Prestations
// prévues, sans document contractuel. Mutualisée desktop (/sites/[id]/prestations)
// et mobile (/m/site/[siteId]/prestations) : une seule server action, une seule
// validation, un seul geste métier.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { createSiteEngagementManual, getEngagementAuthContext, activateEngagement } from '@/lib/db/engagements'
import type { EngagementCategory, EngagementKind } from '@/types/db'

const CATEGORY_VALUES = ['frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other'] as const
const KIND_VALUES = ['objectif', 'obligation', 'livrable', 'controle', 'penalite'] as const

const CreatePlannedEngagementSchema = z.object({
  site_id: z.string().uuid(),
  short_label: z.string().trim().min(1, 'Le libellé est requis').max(500),
  source_excerpt: z.string().trim().max(2000).optional().nullable(),
  category: z.enum(CATEGORY_VALUES),
  kind: z.enum(KIND_VALUES).optional().nullable(),
  measurable: z.boolean(),
})

export async function createPlannedEngagementManualAction(
  input: z.input<typeof CreatePlannedEngagementSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = CreatePlannedEngagementSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const { site_id, short_label, source_excerpt, category, kind, measurable } = parsed.data

  const access = await requireSiteWriteAccess(site_id)
  if (!access.ok) return access

  try {
    const engagement = await createSiteEngagementManual({
      site_id,
      short_label,
      source_excerpt: source_excerpt ?? null,
      category: category as EngagementCategory,
      kind: (kind ?? null) as EngagementKind | null,
      measurable,
      created_by: access.userId,
    })
    revalidatePath(`/sites/${site_id}/prestations`)
    revalidatePath(`/m/site/${site_id}/prestations`)
    return { ok: true, id: engagement.id }
  } catch {
    return { ok: false, error: 'Échec de la création' }
  }
}

// P0-3.2 (mandat Vincent 2026-09-25) — mettre un Engagement Porte B curated en
// vigueur (curated → active). Entrée client minimale : engagement_id. Le
// site_id d'autorisation n'est JAMAIS pris sur le client — il est dérivé
// côté serveur de l'Engagement lui-même, pour empêcher un client de fournir
// un site A qu'il contrôle avec l'Engagement B d'un chantier étranger.
// Ordre fail-closed : Engagement inexistant → refus ; site_id absent → refus ;
// non Porte B (tender_id renseigné) → refus ; statut ≠ curated → refus ;
// SEULEMENT ENSUITE requireSiteWriteAccess(site_id, 'managerOrAdmin') ; puis
// activateEngagement. Réservé à managerOrAdmin (pas chef_equipe) : curated =
// contenu validé, active = règle désormais applicable — geste de poids
// supérieur à la simple création manuelle (policy 'operator').
const ActivatePlannedEngagementSchema = z.object({
  engagement_id: z.string().uuid(),
})

const ACTIVATION_REFUS = 'Impossible de mettre cet engagement en vigueur' as const

export async function activatePlannedEngagementAction(
  input: z.input<typeof ActivatePlannedEngagementSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = ActivatePlannedEngagementSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const engagement = await getEngagementAuthContext(parsed.data.engagement_id)
  if (!engagement) return { ok: false, error: ACTIVATION_REFUS }
  if (!engagement.site_id) return { ok: false, error: ACTIVATION_REFUS }
  if (engagement.tender_id) return { ok: false, error: ACTIVATION_REFUS }
  if (engagement.status !== 'curated') return { ok: false, error: ACTIVATION_REFUS }

  const access = await requireSiteWriteAccess(engagement.site_id, 'managerOrAdmin')
  if (!access.ok) return access

  try {
    await activateEngagement(engagement.id)
  } catch {
    return { ok: false, error: 'Échec de la mise en vigueur' }
  }

  revalidatePath(`/sites/${engagement.site_id}/prestations`)
  revalidatePath(`/m/site/${engagement.site_id}/prestations`)
  return { ok: true }
}
