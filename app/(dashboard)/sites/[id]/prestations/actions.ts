'use server'

// P0-3.1A — Porte B manuelle : ajouter un Engagement depuis Prestations
// prévues, sans document contractuel. Mutualisée desktop (/sites/[id]/prestations)
// et mobile (/m/site/[siteId]/prestations) : une seule server action, une seule
// validation, un seul geste métier.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { createSiteEngagementManual, getEngagementAuthContext, activateEngagement } from '@/lib/db/engagements'
import { createActionFromEngagementPoint } from '@/lib/db/site-action-engagement-links'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import { resolveSubjectAndAttachCanonicalBusinessObject } from '@/lib/db/canonical-business-object-attach'
import type { EngagementCategory, EngagementKind, EngagementLinkQualification } from '@/types/db'

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

// « Traiter un point » (mandat Vincent 2026-09-25) — assistant de création
// d'Action depuis un Engagement ACTIF. « MemorIA peut proposer d'agir ;
// l'utilisateur décide qu'une Action est nécessaire » : ceci ne crée rien tant
// que l'humain n'a pas rempli motif + description et cliqué « Créer
// l'action ». Un seul clic crée, dans la MÊME TRANSACTION SQL (migration 441,
// fn_create_action_from_engagement_point), le site_action, le rapprochement
// P0-4B et la qualification P0-4C — jamais de nouvelle taxonomie, jamais de
// nouvel objet « fait terrain » persistant : les 4 qualifications et le champ
// note existants sont réutilisés tels quels (motif → qualification,
// description → titre de l'Action, origine facultative → note de la
// qualification). Même ordre fail-closed que activatePlannedEngagementAction :
// Engagement inexistant/sans site/non actif → refus, PUIS
// requireSiteWriteAccess(site_id, 'managerOrAdmin'). FIX_REQUIRED (review
// ChatGPT sur c05469a7) : un échec à n'importe quelle étape interne fait
// rollback les trois écritures — jamais d'Action orpheline, jamais de
// compensation par DELETE. Les effets non critiques (invalidation de
// projection, rattachement best-effort au sujet canonique) restent
// non-transactionnels et ne s'exécutent qu'APRÈS le succès de la RPC.
const QUALIFICATIONS = ['demande_evolution', 'mise_en_oeuvre', 'ecart_a_examiner', 'clarification'] as const

const CreateActionFromEngagementSchema = z.object({
  engagement_id: z.string().uuid(),
  qualification: z.enum(QUALIFICATIONS),
  description: z.string().trim().min(1, 'La description est requise').max(2000),
  origin: z.string().trim().max(500).optional().nullable(),
})

const TREAT_POINT_REFUS = 'Impossible de créer cette Action' as const

export async function createActionFromEngagementAction(
  input: z.input<typeof CreateActionFromEngagementSchema>,
): Promise<{ ok: true; actionId: string } | { ok: false; error: string }> {
  const parsed = CreateActionFromEngagementSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Paramètres invalides' }
  const { engagement_id, qualification, description, origin } = parsed.data

  const engagement = await getEngagementAuthContext(engagement_id)
  if (!engagement) return { ok: false, error: TREAT_POINT_REFUS }
  if (!engagement.site_id) return { ok: false, error: TREAT_POINT_REFUS }
  if (engagement.status !== 'active') return { ok: false, error: TREAT_POINT_REFUS }

  const access = await requireSiteWriteAccess(engagement.site_id, 'managerOrAdmin')
  if (!access.ok) return access

  const result = await createActionFromEngagementPoint({
    engagementId: engagement.id,
    siteId: engagement.site_id,
    organizationId: access.organizationId,
    title: description,
    qualification: qualification as EngagementLinkQualification,
    note: origin || null,
    createdBy: access.userId,
  })
  if (!result.ok) return result

  // Effets non critiques, non-transactionnels, APRÈS le commit atomique —
  // exactement ce que createSiteAction() fait déjà pour tout autre appelant.
  invalidateSiteProjection(engagement.site_id)
  void resolveSubjectAndAttachCanonicalBusinessObject({
    siteId: engagement.site_id,
    entityType: 'site_action',
    entityId: result.actionId,
    label: description,
    date: null,
    knownCanonicalSubjectId: null,
  })

  revalidatePath(`/sites/${engagement.site_id}/prestations`)
  revalidatePath(`/m/site/${engagement.site_id}/prestations`)
  revalidatePath(`/sites/${engagement.site_id}/actions`)
  return { ok: true, actionId: result.actionId }
}
