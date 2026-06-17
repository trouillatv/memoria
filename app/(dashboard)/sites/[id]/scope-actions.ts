'use server'

// Server actions des nœuds de mémoire (scopes) — Sprint 3.
// Création / rattachement / suppression. Gardées : manager|admin + org-scope.
// Pas de recherche, pas de LLM (S3 minimal).

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireManagerOrAdmin } from '@/lib/auth/require'
import { getOrgId } from '@/lib/db/users'
import { logUsageEvent } from '@/lib/db/usage-events'
import {
  createScope,
  softDeleteScope,
  setActionScope,
  setAnomalyScope,
  setPhotoScope,
} from '@/lib/db/memory-scopes'

type Result = { ok: true } | { ok: false; error: string }

// Clé de type SOUPLE : minuscules/chiffres/tirets (cohérent avec org_catalog.key).
const KEY_RE = /^[a-z0-9-]+$/

const createSchema = z.object({
  siteId: z.string().uuid(),
  label: z.string().trim().min(1, 'Nom requis').max(80, '80 caractères max'),
  scopeTypeKey: z
    .string()
    .max(64)
    .regex(KEY_RE, 'Clé de type invalide')
    .nullable()
    .optional(),
  description: z.string().trim().max(500).nullable().optional(),
})

export async function createScopeAction(input: {
  siteId: string
  label: string
  scopeTypeKey?: string | null
  description?: string | null
}): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  const orgId = await getOrgId()
  if (!orgId) return { ok: false, error: 'Organisation introuvable' }

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  try {
    await createScope({
      orgId,
      siteId: parsed.data.siteId,
      label: parsed.data.label,
      scopeTypeKey: parsed.data.scopeTypeKey ?? null,
      description: parsed.data.description ?? null,
      createdBy: auth.userId,
    })
    revalidatePath(`/sites/${parsed.data.siteId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

const deleteSchema = z.object({
  scopeId: z.string().uuid(),
  siteId: z.string().uuid(),
})

export async function deleteScopeAction(input: {
  scopeId: string
  siteId: string
}): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  const orgId = await getOrgId()
  if (!orgId) return { ok: false, error: 'Organisation introuvable' }

  const parsed = deleteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Champs invalides' }

  try {
    await softDeleteScope(parsed.data.scopeId, orgId)
    revalidatePath(`/sites/${parsed.data.siteId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

const attachSchema = z.object({
  actionId: z.string().uuid(),
  scopeId: z.string().uuid().nullable(),
  siteId: z.string().uuid(),
})

export async function setActionScopeAction(input: {
  actionId: string
  scopeId: string | null
  siteId: string
}): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  const orgId = await getOrgId()
  if (!orgId) return { ok: false, error: 'Organisation introuvable' }

  const parsed = attachSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Champs invalides' }

  try {
    await setActionScope({
      actionId: parsed.data.actionId,
      scopeId: parsed.data.scopeId,
      orgId,
    })
    revalidatePath(`/sites/${parsed.data.siteId}`)
    if (parsed.data.scopeId) revalidatePath(`/sites/${parsed.data.siteId}/scopes/${parsed.data.scopeId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

const attachAnomalySchema = z.object({
  anomalyId: z.string().uuid(),
  scopeId: z.string().uuid().nullable(),
  siteId: z.string().uuid(),
})

export async function setAnomalyScopeAction(input: {
  anomalyId: string
  scopeId: string | null
  siteId: string
}): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  const orgId = await getOrgId()
  if (!orgId) return { ok: false, error: 'Organisation introuvable' }

  const parsed = attachAnomalySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Champs invalides' }

  try {
    await setAnomalyScope({
      anomalyId: parsed.data.anomalyId,
      scopeId: parsed.data.scopeId,
      orgId,
    })
    revalidatePath(`/sites/${parsed.data.siteId}`)
    if (parsed.data.scopeId) revalidatePath(`/sites/${parsed.data.siteId}/scopes/${parsed.data.scopeId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

const attachPhotoSchema = z.object({
  photoId: z.string().uuid(),
  scopeId: z.string().uuid().nullable(),
  siteId: z.string().uuid(),
})

export async function setPhotoScopeAction(input: {
  photoId: string
  scopeId: string | null
  siteId: string
}): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }
  const orgId = await getOrgId()
  if (!orgId) return { ok: false, error: 'Organisation introuvable' }

  const parsed = attachPhotoSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Champs invalides' }

  try {
    await setPhotoScope({
      photoId: parsed.data.photoId,
      scopeId: parsed.data.scopeId,
      orgId,
    })
    revalidatePath(`/sites/${parsed.data.siteId}`)
    if (parsed.data.scopeId) revalidatePath(`/sites/${parsed.data.siteId}/scopes/${parsed.data.scopeId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// Instrumentation S3.5 (Test B Vincent) : rattachement assisté accepté tel quel,
// corrigé, ou fait à la main. Best-effort, jamais bloquant. Sert à mesurer la
// QUALITÉ des suggestions (taux d'acceptation sans correction) dans le temps —
// PAS affiché à l'utilisateur. event = scope_attach:{accepted|overridden|manual}.
export async function logScopeAttachAction(
  outcome: 'accepted' | 'overridden' | 'manual',
  siteId: string,
): Promise<void> {
  if (!['accepted', 'overridden', 'manual'].includes(outcome)) return
  void logUsageEvent({ event: `scope_attach:${outcome}`, siteId })
}
