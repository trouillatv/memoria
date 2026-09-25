'use server'

// P0-3.1A — Porte B manuelle : ajouter un Engagement depuis Prestations
// prévues, sans document contractuel. Mutualisée desktop (/sites/[id]/prestations)
// et mobile (/m/site/[siteId]/prestations) : une seule server action, une seule
// validation, un seul geste métier.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { createSiteEngagementManual, getEngagementAuthContext, activateEngagement } from '@/lib/db/engagements'
import { createSiteAction } from '@/lib/db/site-actions'
import { createSiteActionEngagementLink, addEngagementLinkQualification } from '@/lib/db/site-action-engagement-links'
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
// l'action ». Un seul clic crée, dans la même opération logique, le
// site_action, le rapprochement P0-4B et la qualification P0-4C — jamais de
// nouvelle taxonomie, jamais de nouvel objet « fait terrain » persistant :
// les 4 qualifications et le champ note existants sont réutilisés tels quels
// (motif → qualification, description → titre de l'Action, origine
// facultative → note de la qualification). Même ordre fail-closed que
// activatePlannedEngagementAction : Engagement inexistant/sans site/non actif
// → refus, PUIS requireSiteWriteAccess(site_id, 'managerOrAdmin'). En cas
// d'échec du rapprochement ou de la qualification après création de l'Action,
// celle-ci reste (aucune primitive de suppression de site_action n'existe,
// par doctrine) : l'humain peut alors la rapprocher/qualifier manuellement
// depuis sa fiche (mécanisme P0-4B/P0-4C déjà en place) — aucune perte.
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

  const actionId = await createSiteAction({
    site_id: engagement.site_id,
    title: description,
    created_by: access.userId,
    created_from: 'engagement_treat_point',
  })

  const linkResult = await createSiteActionEngagementLink({
    siteActionId: actionId,
    engagementId: engagement.id,
    organizationId: access.organizationId,
    createdBy: access.userId,
  })
  if (!linkResult.ok) return linkResult

  const qualifyResult = await addEngagementLinkQualification({
    linkId: linkResult.id,
    qualification: qualification as EngagementLinkQualification,
    note: origin || null,
    organizationId: access.organizationId,
    createdBy: access.userId,
  })
  if (!qualifyResult.ok) return qualifyResult

  revalidatePath(`/sites/${engagement.site_id}/prestations`)
  revalidatePath(`/m/site/${engagement.site_id}/prestations`)
  revalidatePath(`/sites/${engagement.site_id}/actions`)
  return { ok: true, actionId }
}
