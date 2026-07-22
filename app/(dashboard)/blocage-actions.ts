'use server'

// Server Actions des blocages de chantier (mig 160). Partagées entre la page
// Réunion (création depuis un CR / détection PV) et la page Site (déclaration
// directe). Garde-fou : manager ou admin uniquement. Écriture service-role ;
// scoping org assuré par le site rattaché.
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { getSiteReport } from '@/lib/db/site-reports'
import {
  createSiteBlocage,
  updateSiteBlocage,
  deleteSiteBlocage,
} from '@/lib/db/site-blocages'
import { getSiteDayLogId } from '@/lib/db/site-day-log'
import { BLOCAGE_TYPES, type BlocageType } from '@/lib/db/blocage-constants'

type Result = { ok: boolean; error?: string }

async function requireManagerOrAdmin() {
  const user = await getCurrentUserWithProfile()
  if (!user) throw new Error('Not authenticated')
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Forbidden')
  return user
}

function coerceType(t: string | null | undefined): BlocageType {
  return (BLOCAGE_TYPES as readonly string[]).includes(t ?? '') ? (t as BlocageType) : 'autre'
}

/** Blocage météo → lie le jour de météo existant (mig 161), sans le recopier.
 *  Best-effort : si aucun jour n'existe encore, le lien reste vide. */
async function resolveWeatherDayLogId(
  type: BlocageType,
  siteId: string,
  dateStart: string | null | undefined,
): Promise<string | null> {
  if (type !== 'intemperie' || !dateStart) return null
  try {
    return await getSiteDayLogId(siteId, dateStart)
  } catch {
    return null
  }
}

export interface NewBlocageInput {
  type: string
  title: string
  description?: string | null
  impact?: string | null
  dateStart?: string | null
  dateEnd?: string | null
}

/** Déclaration d'un blocage DEPUIS LE SITE (contexte hors réunion). */
export async function declareSiteBlocageAction(
  siteId: string,
  input: NewBlocageInput,
): Promise<Result> {
  try {
    const user = await requireManagerOrAdmin()
    if (!input.title?.trim()) return { ok: false, error: 'Titre requis' }
    const supabase = createAdminClient()
    const { data: site } = await supabase.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
    if (!site) throw new Error('Chantier introuvable')
    const membership = await requireOrganizationMembership(site.organization_id)
    if (!membership.ok) throw new Error(membership.error)
    const type = coerceType(input.type)
    await createSiteBlocage({
      siteId,
      type,
      title: input.title,
      description: input.description ?? null,
      impact: input.impact ?? null,
      dateStart: input.dateStart ?? null,
      dateEnd: input.dateEnd ?? null,
      dayLogId: await resolveWeatherDayLogId(type, siteId, input.dateStart),
      sourceType: 'human',
      organizationId: site.organization_id,
      createdBy: user.id,
    })
    revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Création d'un blocage DEPUIS UNE RÉUNION/PV (manuelle ou validée depuis une
 *  détection). `detected` = proposée par la détection PV puis confirmée. */
export async function addBlocageFromReportAction(
  reportId: string,
  input: NewBlocageInput & { sourceType?: 'meeting' | 'detected' },
): Promise<Result> {
  try {
    const user = await requireManagerOrAdmin()
    const report = await getSiteReport(reportId)
    if (!report?.site_id) return { ok: false, error: 'Réunion sans chantier rattaché' }
    if (!input.title?.trim()) return { ok: false, error: 'Titre requis' }
    const supabase = createAdminClient()
    const { data: site } = await supabase.from('sites').select('organization_id').eq('id', report.site_id).maybeSingle()
    if (!site) throw new Error('Chantier introuvable')
    const membership = await requireOrganizationMembership(site.organization_id)
    if (!membership.ok) throw new Error(membership.error)
    const type = coerceType(input.type)
    // Par défaut : daté au jour du CR (mémoire de contexte cohérente).
    const dateStart = input.dateStart ?? report.created_at?.slice(0, 10) ?? null
    await createSiteBlocage({
      siteId: report.site_id,
      type,
      title: input.title,
      description: input.description ?? null,
      impact: input.impact ?? null,
      dateStart,
      dateEnd: input.dateEnd ?? null,
      dayLogId: await resolveWeatherDayLogId(type, report.site_id, dateStart),
      sourceType: input.sourceType ?? 'meeting',
      sourceReportId: reportId,
      organizationId: site.organization_id,
      createdBy: user.id,
    })
    revalidatePath(`/meetings/${reportId}`)
    revalidatePath(`/sites/${report.site_id}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function editBlocageAction(
  siteId: string,
  id: string,
  patch: {
    type?: string
    title?: string
    description?: string | null
    impact?: string | null
    dateStart?: string
    dateEnd?: string | null
  },
): Promise<Result> {
  try {
    await requireManagerOrAdmin()
    await updateSiteBlocage(siteId, id, {
      ...(patch.type !== undefined ? { type: coerceType(patch.type) } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.impact !== undefined ? { impact: patch.impact } : {}),
      ...(patch.dateStart !== undefined ? { dateStart: patch.dateStart } : {}),
      ...(patch.dateEnd !== undefined ? { dateEnd: patch.dateEnd } : {}),
    })
    revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Marque un blocage comme levé (date_end = jour fourni ou aujourd'hui). */
export async function resolveBlocageAction(
  siteId: string,
  id: string,
  dateEnd: string | null,
): Promise<Result> {
  try {
    await requireManagerOrAdmin()
    await updateSiteBlocage(siteId, id, { dateEnd: dateEnd ?? new Date().toISOString().slice(0, 10) })
    revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deleteBlocageAction(siteId: string, id: string): Promise<Result> {
  try {
    await requireManagerOrAdmin()
    await deleteSiteBlocage(siteId, id)
    revalidatePath(`/sites/${siteId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
