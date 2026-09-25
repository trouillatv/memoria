'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createMission, updateMission, getMission } from '@/lib/db/missions'
import { getSiteById } from '@/lib/db/sites'
import {
  listActiveEngagementsByContracts,
  listActiveEngagementsBySites,
} from '@/lib/db/engagements'
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'

// FIX_REQUIRED P0-3.5A FINAL — le rôle métier vient du membership dans
// l'organisation DU CHANTIER (doctrine M2C), jamais de users.role : un compte
// manager sur son profil mais chef_equipe sur l'organisation propriétaire du
// site ne doit pas pouvoir créer/modifier une Mission de ce chantier.
// requireSiteWriteAccess résout à la fois l'appartenance et le rôle dans
// l'organisation du site — remplace l'ancienne paire
// requireManagerOrAdmin()+requireOwned() qui vérifiait ces deux dimensions
// séparément, l'une sur le mauvais référentiel (users.role).
const REFUS = 'Accès refusé' as const

/**
 * Population d'Engagements autorisée pour un site : Porte A (contrat du
 * site, active/completed) ∪ Porte B (site lui-même, active). Le picker UI
 * filtre déjà pareil, mais un client ne doit jamais pouvoir imposer un
 * engagement_id hors population via un appel direct à la server action
 * (FIX_REQUIRED P0-3.5A #1). `preserveIds` (IDs déjà liés à la Mission avant
 * la mutation) sont acceptés en plus, même sortis de la population courante
 * — jamais de nouveau rattachement hors population, mais jamais de perte
 * silencieuse d'un lien historique légitime (même doctrine que le picker,
 * cf. mission-editor.tsx). Sert à valider aussi bien `engagement_ids` que
 * les `engagement_id` référencés depuis `default_checklist`.
 */
async function resolveEngagementAuthorization(
  siteId: string,
  preserveIds: string[] = []
): Promise<{ allowed: Set<string>; preserved: Set<string> }> {
  const site = await getSiteById(siteId)
  const allowed = new Set<string>()
  if (site?.contract_id) {
    const byContract = await listActiveEngagementsByContracts([site.contract_id])
    for (const e of byContract.get(site.contract_id) ?? []) allowed.add(e.id)
  }
  const bySite = await listActiveEngagementsBySites([siteId])
  for (const e of bySite.get(siteId) ?? []) allowed.add(e.id)
  return { allowed, preserved: new Set(preserveIds) }
}

function filterAuthorizedIds(requestedIds: string[], auth: { allowed: Set<string>; preserved: Set<string> }): string[] {
  return requestedIds.filter((eid) => auth.allowed.has(eid) || auth.preserved.has(eid))
}

/** Referme le champ engagement_id d'un item de checklist hors population/préservation (jamais de rejet global pour un seul champ optionnel). */
function sanitizeChecklistEngagementId(
  item: { engagement_id?: string | null },
  auth: { allowed: Set<string>; preserved: Set<string> }
): string | undefined {
  if (!item.engagement_id) return undefined
  return auth.allowed.has(item.engagement_id) || auth.preserved.has(item.engagement_id)
    ? item.engagement_id
    : undefined
}

const cadenceSchema = z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'on_demand'])

const checklistItemSchema = z.object({
  label: z.string().min(1).max(200),
  required: z.boolean().optional(),
  engagement_id: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
  // Item « à quantité » (migration 111) : non null = on attend un compte.
  expected_qty: z.number().min(0).max(1_000_000).nullable().optional(),
})

const createMissionSchema = z.object({
  site_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  cadence: cadenceSchema,
  engagement_ids: z.array(z.string().uuid()).default([]),
  default_checklist: z.array(checklistItemSchema).default([]),
})

export async function createMissionAction(formData: FormData) {
  const engagementIdsRaw = formData.get('engagement_ids') as string
  const checklistRaw = formData.get('default_checklist') as string
  let engagement_ids: string[] = []
  let default_checklist: unknown[] = []
  try {
    engagement_ids = engagementIdsRaw ? JSON.parse(engagementIdsRaw) : []
    default_checklist = checklistRaw ? JSON.parse(checklistRaw) : []
  } catch {
    return { error: 'Invalid JSON in engagement_ids or default_checklist' }
  }

  const parsed = createMissionSchema.safeParse({
    site_id: formData.get('site_id'),
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    cadence: formData.get('cadence'),
    engagement_ids,
    default_checklist,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  // FIX_REQUIRED P0-3.5A FINAL : rôle métier résolu dans l'organisation DU
  // SITE, pas depuis users.role.
  const access = await requireSiteWriteAccess(parsed.data.site_id, 'managerOrAdmin')
  if (!access.ok) return { error: access.error }

  // FIX_REQUIRED P0-3.5A #1 : ne jamais faire confiance aux engagement_ids
  // du client (ni ceux de engagement_ids, ni ceux référencés depuis
  // default_checklist), recalculer la population autorisée depuis le site
  // lui-même.
  const engagementAuth = await resolveEngagementAuthorization(parsed.data.site_id)

  const missionId = await createMission({
    site_id: parsed.data.site_id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    cadence: parsed.data.cadence,
    default_team: [],
    engagement_ids: filterAuthorizedIds(parsed.data.engagement_ids, engagementAuth),
    default_checklist: parsed.data.default_checklist.map((it, idx) => ({
      label: it.label,
      required: it.required ?? false,
      engagement_id: sanitizeChecklistEngagementId(it, engagementAuth),
      position: idx + 1,
      expected_qty: it.expected_qty ?? null,
    })),
    created_by: access.userId,
  })

  // Règle d'or (lot R) : ce chemin ne revalidait RIEN — incohérent avec le
  // chemin global (/missions). La mission doit apparaître partout où elle
  // est listée, y compris le picker de /semaine.
  revalidatePath('/missions')
  revalidatePath('/semaine')

  return { ok: true as const, missionId }
}

const updateMissionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  cadence: cadenceSchema.optional(),
  engagement_ids: z.array(z.string().uuid()).optional(),
  default_checklist: z.array(checklistItemSchema).optional(),
  active: z.boolean().optional(),
})

export async function updateMissionAction(formData: FormData) {
  const engagementIdsRaw = formData.get('engagement_ids') as string | null
  const checklistRaw = formData.get('default_checklist') as string | null
  let engagement_ids: string[] | undefined
  let default_checklist: unknown[] | undefined
  try {
    if (engagementIdsRaw !== null) engagement_ids = JSON.parse(engagementIdsRaw)
    if (checklistRaw !== null) default_checklist = JSON.parse(checklistRaw)
  } catch {
    return { error: 'Invalid JSON' }
  }

  const parsed = updateMissionSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name') || undefined,
    description: formData.get('description'),
    cadence: formData.get('cadence') || undefined,
    engagement_ids,
    default_checklist,
    active: formData.get('active') === 'true' ? true : formData.get('active') === 'false' ? false : undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { id, default_checklist: dc, engagement_ids: requestedEngagementIds, ...rest } = parsed.data
  const patch: Record<string, unknown> = { ...rest }

  // FIX_REQUIRED P0-3.5A FINAL : le site est immuable en édition (absent du
  // formulaire) — le résoudre depuis la Mission elle-même, jamais depuis une
  // valeur cliente, puis autoriser CETTE mutation via requireSiteWriteAccess
  // sur ce site (rôle résolu dans l'organisation DU SITE, pas users.role).
  // Vérifié sur CHAQUE update, même quand ni engagement_ids ni
  // default_checklist ne sont soumis. Mission absente ou refus d'accès
  // renvoient le MÊME message : aucun oracle ne doit permettre de distinguer
  // « n'existe pas » de « existe mais appartient à une autre organisation ».
  const mission = await getMission(id)
  if (!mission) return { error: REFUS }
  const access = await requireSiteWriteAccess(mission.site_id, 'managerOrAdmin')
  if (!access.ok) return { error: REFUS }

  const engagementAuth = await resolveEngagementAuthorization(mission.site_id, mission.engagement_ids)

  if (requestedEngagementIds !== undefined) {
    patch.engagement_ids = filterAuthorizedIds(requestedEngagementIds, engagementAuth)
  }

  if (dc) {
    patch.default_checklist = dc.map((it, idx) => ({
      label: it.label,
      required: it.required ?? false,
      engagement_id: sanitizeChecklistEngagementId(it, engagementAuth),
      position: idx + 1,
      expected_qty: it.expected_qty ?? null,
    }))
  }
  await updateMission(id, patch)
  return { ok: true as const }
}
