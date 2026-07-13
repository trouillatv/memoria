import 'server-only'

// LE CALENDRIER SCOLAIRE (mig 203) — un fait d'ORGANISATION, pas de chantier.
//
// INVARIANT : le calendrier est la SOURCE. Les fermetures qu'il produit
// (`site_closures.calendar_period_id` non nul) en sont une PROJECTION : on ne
// les modifie jamais à la main, on les RÉGÉNÈRE. Même doctrine que les rythmes
// d'un roulement.
//
// ⚠️ RÉGÉNÉRER N'EST PAS SUPPRIMER. Une fermeture retirée l'est LOGIQUEMENT
// (`deleted_at`) : elle a pu servir de base à une décision, et l'effacer
// réécrirait l'histoire.
//
// On ne touche JAMAIS au passé : seules les périodes en cours ou à venir sont
// (re)générées.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso } from '@/lib/time/local-date'
import {
  derivedClosuresFor,
  upcomingPeriods,
  type CalendarPeriod,
} from '@/lib/planning/school-calendar'

export interface SchoolPeriod extends CalendarPeriod {
  /** Combien de chantiers cette période ferme réellement. */
  sitesCount?: number
}

function rowToPeriod(r: Record<string, unknown>): SchoolPeriod {
  return {
    id: r.id as string,
    label: (r.label as string) ?? '',
    startsOn: (r.starts_on as string) ?? '',
    endsOn: (r.ends_on as string) ?? '',
  }
}

/** Dégradation gracieuse tant que la mig 203 n'est pas appliquée. */
function isMissing(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || (error.message ?? '').includes('school_calendar_period')
}

/** Les périodes du calendrier de l'organisation, de la plus proche à la plus lointaine. */
export async function listPeriods(): Promise<SchoolPeriod[]> {
  const db = createAdminClient()
  const orgId = await getOrgId().catch(() => null)
  if (!orgId) return []

  const { data, error } = await db
    .from('school_calendar_period')
    .select('id, label, starts_on, ends_on')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('starts_on', { ascending: true })
  if (error) {
    if (isMissing(error)) return []
    throw new Error(error.message)
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map(rowToPeriod)
}

export interface PeriodInput {
  label: string
  startsOn: string
  endsOn: string
  userId: string | null
}

export async function createPeriod(input: PeriodInput): Promise<string> {
  const db = createAdminClient()
  const orgId = await getOrgId()
  if (!orgId) throw new Error('Organisation introuvable')

  const { data, error } = await db
    .from('school_calendar_period')
    .insert({
      organization_id: orgId,
      label: input.label,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Création impossible')
  return (data as { id: string }).id
}

export async function updatePeriod(id: string, input: PeriodInput): Promise<void> {
  const db = createAdminClient()
  const orgId = await getOrgId()
  const { error } = await db
    .from('school_calendar_period')
    .update({
      label: input.label,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', orgId ?? '')
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
}

/** Retirer une période : elle sort du calendrier, et les fermetures qu'elle avait
 *  produites sont retirées elles aussi — logiquement, jamais effacées. */
export async function removePeriod(id: string): Promise<void> {
  const db = createAdminClient()
  const orgId = await getOrgId()
  const now = new Date().toISOString()

  const { error } = await db
    .from('school_calendar_period')
    .update({ deleted_at: now })
    .eq('id', id)
    .eq('organization_id', orgId ?? '')
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  await db
    .from('site_closures')
    .update({ deleted_at: now })
    .eq('calendar_period_id', id)
    .is('deleted_at', null)
}

/** Le chantier suit-il le calendrier ? Explicite, jamais déduit. */
export async function setSiteFollowsCalendar(siteId: string, follows: boolean): Promise<void> {
  const db = createAdminClient()
  const { error } = await db
    .from('sites')
    .update({ follows_school_calendar: follows })
    .eq('id', siteId)
  if (error) throw new Error(error.message)

  await syncSiteClosures(siteId)
}

/** Ce chantier suit-il le calendrier ? */
export async function siteFollowsCalendar(siteId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('sites')
    .select('follows_school_calendar')
    .eq('id', siteId)
    .maybeSingle()
  return Boolean((data as { follows_school_calendar: boolean } | null)?.follows_school_calendar)
}

/** Les chantiers de l'organisation qui suivent le calendrier. */
export async function listFollowingSiteIds(): Promise<string[]> {
  const db = createAdminClient()
  const orgId = await getOrgId().catch(() => null)

  let q = db.from('sites').select('id').eq('follows_school_calendar', true).is('deleted_at', null)
  if (orgId) q = q.eq('organization_id', orgId)

  const { data, error } = await q
  if (error) return []
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

/**
 * RÉGÉNÈRE les fermetures dérivées d'UN chantier.
 *
 * On retire (logiquement) les fermetures dérivées À VENIR, puis on les récrée
 * depuis le calendrier. Le passé n'est jamais touché : une fermeture déjà vécue
 * a pu porter une décision.
 *
 * Les fermetures SAISIES À LA MAIN (`calendar_period_id` NULL) ne sont jamais
 * concernées — elles appartiennent à l'utilisateur, pas au calendrier.
 */
export async function syncSiteClosures(siteId: string): Promise<{ created: number }> {
  const db = createAdminClient()
  const today = todayLocalIso()

  const { data: siteRow } = await db
    .from('sites')
    .select('follows_school_calendar')
    .eq('id', siteId)
    .maybeSingle()
  const follows = (siteRow as { follows_school_calendar: boolean } | null)?.follows_school_calendar

  // On retire d'abord les dérivées à venir — qu'on suive encore ou non.
  const { error: delErr } = await db
    .from('site_closures')
    .update({ deleted_at: new Date().toISOString() })
    .eq('site_id', siteId)
    .not('calendar_period_id', 'is', null)
    .gte('ends_on', today) // le passé reste intact
    .is('deleted_at', null)
  if (delErr && !isMissing(delErr)) throw new Error(delErr.message)

  if (!follows) return { created: 0 }

  const periods = upcomingPeriods(await listPeriods(), today)
  const rows = derivedClosuresFor(siteId, periods)
  if (rows.length === 0) return { created: 0 }

  const { error } = await db.from('site_closures').insert(
    rows.map((r) => ({
      site_id: r.siteId,
      calendar_period_id: r.calendarPeriodId,
      reason_kind: r.reasonKind,
      reason: r.reason,
      starts_on: r.startsOn,
      ends_on: r.endsOn,
    })),
  )
  if (error) throw new Error(error.message)

  return { created: rows.length }
}

/** Après une modification du calendrier : tous les chantiers qui le suivent. */
export async function syncAllFollowingSites(): Promise<{ sites: number }> {
  const ids = await listFollowingSiteIds()
  for (const id of ids) await syncSiteClosures(id)
  return { sites: ids.length }
}
