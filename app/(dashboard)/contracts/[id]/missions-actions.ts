'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { createMission, updateMission, getMission } from '@/lib/db/missions'
import { getSiteById } from '@/lib/db/sites'
import {
  listActiveEngagementsByContracts,
  listActiveEngagementsBySites,
} from '@/lib/db/engagements'
import { requireOwned } from '@/lib/auth/ownership'
import type { UserRole } from '@/types/db'

async function requireManagerOrAdmin(): Promise<{ userId: string; role: UserRole } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Forbidden' }
  return { userId: user.id, role }
}

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
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

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

  // Lot S : le chantier ciblé doit être de mon organisation.
  const owned = await requireOwned(auth.role, 'sites', parsed.data.site_id)
  if (!owned.allowed) return { error: owned.error }

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
    created_by: auth.userId,
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
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return auth

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

  // FIX_REQUIRED P0-3.5A #1 (revue finale) : le site est immuable en édition
  // (absent du formulaire) — le résoudre depuis la Mission elle-même, jamais
  // depuis une valeur cliente, et autoriser CETTE mutation via ce site avec
  // requireOwned — jamais se fier au seul rôle plateforme
  // (requireManagerOrAdmin ne prouve pas l'appartenance à l'organisation
  // propriétaire de cette Mission précise). Vérifié sur CHAQUE update, même
  // quand ni engagement_ids ni default_checklist ne sont soumis.
  const mission = await getMission(id)
  if (!mission) return { error: 'Mission introuvable' }
  const owned = await requireOwned(auth.role, 'sites', mission.site_id)
  if (!owned.allowed) return { error: owned.error }

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
