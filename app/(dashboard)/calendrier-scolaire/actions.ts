'use server'

// Le calendrier scolaire — écrire les périodes, et propager.
//
// Toute écriture RÉGÉNÈRE les fermetures des chantiers qui suivent le
// calendrier. Le calendrier est la source ; les fermetures en sont la
// projection. On ne les modifie jamais à la main.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireManagerOrAdmin } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import {
  createPeriod,
  updatePeriod,
  removePeriod,
  setSiteFollowsCalendar,
  setSiteFollowsHolidays,
  syncAllFollowingSites,
} from '@/lib/db/school-calendar'
import { logAuditEvent } from '@/lib/audit/log'

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide')

const periodSchema = z
  .object({
    id: z.string().uuid().optional(),
    /** Vacances scolaires ou jour férié — même mécanique, deux calendriers. */
    kind: z.enum(['scolaire', 'ferie']).default('scolaire'),
    label: z.string().trim().min(1, 'Donnez un nom à cette période').max(120),
    startsOn: dateIso,
    endsOn: dateIso,
  })
  .refine((d) => d.endsOn >= d.startsOn, {
    message: 'La fin ne peut pas précéder le début',
    path: ['endsOn'],
  })

export async function savePeriodAction(
  input: unknown,
): Promise<{ ok: true; sites: number } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const parsed = periodSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  const d = parsed.data

  const payload = {
    kind: d.kind,
    label: d.label,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    userId: auth.userId,
  }
  if (d.id) await updatePeriod(d.id, payload)
  else await createPeriod(payload)

  // La modification se propage TOUT DE SUITE : un calendrier qui n'a pas encore
  // fermé les écoles ne sert à rien.
  const { sites } = await syncAllFollowingSites()

  revalidateAll()
  return { ok: true, sites }
}

export async function removePeriodAction(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!z.string().uuid().safeParse(id).success) return { error: 'Identifiant invalide' }

  await removePeriod(id)

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'organization',
    entityId: id,
    action: 'removed',
    metadata: { kind: 'school_calendar_period' },
  })

  revalidateAll()
  return { ok: true }
}

/** « Ce chantier ferme pendant les vacances scolaires. » */
export async function setSiteFollowsCalendarAction(
  siteId: string,
  follows: boolean,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!z.string().uuid().safeParse(siteId).success) return { error: 'Identifiant invalide' }

  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return { error: owned.error }

  await setSiteFollowsCalendar(siteId, follows)

  revalidatePath(`/sites/${siteId}`)
  revalidateAll()
  return { ok: true }
}

/** « Ce chantier ferme les jours fériés. » Un férié ne ferme JAMAIS tous les
 *  sites d'office — l'adhésion est un choix, par chantier. */
export async function setSiteFollowsHolidaysAction(
  siteId: string,
  follows: boolean,
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!z.string().uuid().safeParse(siteId).success) return { error: 'Identifiant invalide' }

  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return { error: owned.error }

  await setSiteFollowsHolidays(siteId, follows)

  revalidatePath(`/sites/${siteId}`)
  revalidateAll()
  return { ok: true }
}

function revalidateAll(): void {
  revalidatePath('/fermetures')
  revalidatePath('/calendrier-scolaire')
  revalidatePath('/semaine')
  revalidatePath('/dashboard')
}
