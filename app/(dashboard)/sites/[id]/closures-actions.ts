'use server'

// PL2 — fermetures de site. Créer, corriger, retirer. RIEN d'autre :
// aucune intervention n'est déplacée ni annulée ici (c'est PL3, et c'est
// l'humain qui tranchera).
//
// Sécurité : rôle (manager/admin) PUIS appartenance du SITE — la table ne porte
// pas d'`organization_id` (le site la porte déjà), donc la garde anti-IDOR se
// fait sur le parent : `requireOwned(role, 'sites', siteId)`.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireManagerOrAdmin } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import {
  listClosuresBySite,
  getClosure,
  createSiteClosure,
  updateSiteClosure,
  softDeleteSiteClosure,
} from '@/lib/db/site-closures'
import { logAuditEvent } from '@/lib/audit/log'

type Result = { ok: true } | { error: string }

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide')
const reasonKind = z.enum(['holiday', 'client', 'maintenance', 'inventory', 'exceptional', 'other'])

const createSchema = z
  .object({
    siteId: z.string().uuid(),
    reasonKind,
    reason: z.string().trim().max(500).optional(),
    startsOn: dateIso,
    endsOn: dateIso,
  })
  .refine((d) => d.endsOn >= d.startsOn, {
    message: 'La fin ne peut pas précéder le début',
    path: ['endsOn'],
  })

export async function createClosureAction(input: unknown): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }

  // Garde d'appartenance : on ne ferme pas le chantier d'un autre tenant.
  const owned = await requireOwned(auth.role, 'sites', parsed.data.siteId)
  if (!owned.allowed) return { error: owned.error }

  const id = await createSiteClosure({
    siteId: parsed.data.siteId,
    reasonKind: parsed.data.reasonKind,
    reason: parsed.data.reason?.trim() || null,
    startsOn: parsed.data.startsOn,
    endsOn: parsed.data.endsOn,
    createdBy: auth.userId,
  })

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: parsed.data.siteId,
    action: 'created',
    metadata: {
      kind: 'site_closure',
      closure_id: id,
      reason_kind: parsed.data.reasonKind,
      starts_on: parsed.data.startsOn,
      ends_on: parsed.data.endsOn,
    },
  })

  revalidateSite(parsed.data.siteId)
  return { ok: true }
}

const updateSchema = z
  .object({
    closureId: z.string().uuid(),
    reasonKind,
    reason: z.string().trim().max(500).optional(),
    startsOn: dateIso,
    endsOn: dateIso,
  })
  .refine((d) => d.endsOn >= d.startsOn, {
    message: 'La fin ne peut pas précéder le début',
    path: ['endsOn'],
  })

export async function updateClosureAction(input: unknown): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }

  // La fermeture ne porte pas l'organisation : on remonte à son SITE, et c'est
  // LUI qu'on garde. Une fermeture introuvable et une fermeture d'un autre
  // tenant renvoient le même message — pas d'oracle d'existence.
  const closure = await getClosure(parsed.data.closureId)
  if (!closure) return { error: 'Objet introuvable' }
  const owned = await requireOwned(auth.role, 'sites', closure.siteId)
  if (!owned.allowed) return { error: owned.error }

  await updateSiteClosure(parsed.data.closureId, {
    reasonKind: parsed.data.reasonKind,
    reason: parsed.data.reason?.trim() || null,
    startsOn: parsed.data.startsOn,
    endsOn: parsed.data.endsOn,
    updatedBy: auth.userId,
  })

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: closure.siteId,
    action: 'updated',
    metadata: { kind: 'site_closure', closure_id: parsed.data.closureId },
  })

  revalidateSite(closure.siteId)
  return { ok: true }
}

export async function removeClosureAction(closureId: string): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!z.string().uuid().safeParse(closureId).success) return { error: 'Identifiant invalide' }

  const closure = await getClosure(closureId)
  if (!closure) return { error: 'Objet introuvable' }
  const owned = await requireOwned(auth.role, 'sites', closure.siteId)
  if (!owned.allowed) return { error: owned.error }

  await softDeleteSiteClosure(closureId)

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: closure.siteId,
    action: 'removed',
    metadata: { kind: 'site_closure', closure_id: closureId, mode: 'soft' },
  })

  revalidateSite(closure.siteId)
  return { ok: true }
}

/** Lecture pour le composant client après mutation (pas de prop stale). */
export async function listClosuresAction(siteId: string) {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return []
  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return []
  return listClosuresBySite(siteId)
}

/** Règle d'or : toute mutation revalide TOUS les paths qui affichent l'objet.
 *  PL2 n'affiche les fermetures que sur la fiche chantier — /semaine viendra
 *  avec PL3 (le signal), pas avant. */
function revalidateSite(siteId: string): void {
  revalidatePath(`/sites/${siteId}`)
}
