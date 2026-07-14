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
  listPeriods,
  updatePeriod,
  removePeriod,
  setSiteCalendarEffect,
  syncAllFollowingSites,
} from '@/lib/db/school-calendar'
import { missingFrom, NC_CALENDAR_2026 } from '@/lib/planning/nc-calendar-2026'
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

/**
 * IMPORTER LE CALENDRIER CALÉDONIEN 2026 — jours fériés et vacances scolaires.
 *
 * Déclenché par un humain, jamais au démarrage : l'écran ne pré-remplit rien,
 * et cette action ne change pas cette règle — elle propose, on accepte.
 *
 * Rejouable : une période déjà présente (même type, mêmes dates) n'est pas
 * recréée. Cliquer deux fois ne produit pas deux Noël.
 *
 * Ce que l'import NE fait PAS : fermer des chantiers. Une période ne ferme que
 * les chantiers qui la SUIVENT — un magasin reste ouvert quand l'école ferme.
 */
export async function importNcCalendar2026Action(): Promise<
  { ok: true; created: number; alreadyThere: number; sites: number } | { error: string }
> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const existing = await listPeriods()
  const missing = missingFrom(existing)

  for (const seed of missing) {
    await createPeriod({
      kind: seed.kind,
      label: seed.label,
      startsOn: seed.startsOn,
      endsOn: seed.endsOn,
      userId: auth.userId,
    })
  }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'organization',
    entityId: auth.userId,
    action: 'created',
    metadata: {
      kind: 'school_calendar_import',
      source: 'nc_2026',
      created: missing.length,
    },
  })

  // Les fermetures se propagent tout de suite : un calendrier importé qui n'a
  // encore rien fermé ne sert à rien.
  const { sites } = await syncAllFollowingSites()

  revalidateAll()
  return {
    ok: true,
    created: missing.length,
    alreadyThere: NC_CALENDAR_2026.length - missing.length,
    sites,
  }
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

/**
 * LA RÈGLE de ce chantier pour un calendrier (mig 208).
 *
 * Le calendrier dit QUAND ; le chantier dit QUOI :
 *   none   → non concerné ;
 *   closed → fermé pendant la période (SEUL mode qui produit des fermetures) ;
 *   works  → travail prévu pendant la période — aucune fermeture, aucun conflit.
 */
export async function setCalendarEffectAction(
  siteId: string,
  kind: 'scolaire' | 'ferie',
  effect: 'none' | 'closed' | 'works',
): Promise<{ ok: true } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!z.string().uuid().safeParse(siteId).success) return { error: 'Identifiant invalide' }

  const owned = await requireOwned(auth.role, 'sites', siteId)
  if (!owned.allowed) return { error: owned.error }

  await setSiteCalendarEffect(siteId, kind, effect)

  revalidatePath(`/sites/${siteId}`)
  revalidateAll()
  return { ok: true }
}

function revalidateAll(): void {
  revalidatePath('/calendrier')
  revalidatePath('/calendrier-scolaire')
  revalidatePath('/semaine')
  revalidatePath('/dashboard')
}
