// BLOCAGES de chantier (mig 160) — événements datés qui empêchent d'avancer
// (intempérie/grève/accès/livraison/matériel/sous-traitant/administratif/
// sécurité). Mémoire de CONTEXTE opposable. Calqué sur site-decisions (mig 136).
//
// Doctrine : descriptif, niveau SITE, jamais une mesure d'humain — aucun score,
// aucune imputation, aucun %. Un blocage météo POINTE vers site_day_log
// (dayLogId), il ne recopie pas la météo (1 source météo, mig 108).
import { createAdminClient } from '@/lib/supabase/admin'
import { BLOCAGE_TYPES, BLOCAGE_TYPE_LABEL, type BlocageType } from './blocage-constants'
import type { SiteMemoryEvent } from './site-memory'

export { BLOCAGE_TYPES, type BlocageType }

export interface SiteBlocage {
  id: string
  siteId: string
  subjectId: string | null
  type: BlocageType
  title: string
  description: string | null
  impact: string | null
  dateStart: string // yyyy-mm-dd
  dateEnd: string | null // null = encore en cours
  sourceType: 'human' | 'meeting' | 'detected'
  sourceReportId: string | null
  dayLogId: string | null
}

function rowToBlocage(r: Record<string, unknown>): SiteBlocage {
  const type = r.type as string
  return {
    id: r.id as string,
    siteId: r.site_id as string,
    subjectId: (r.subject_id as string | null) ?? null,
    type: (BLOCAGE_TYPES as readonly string[]).includes(type) ? (type as BlocageType) : 'autre',
    title: (r.title as string) ?? '',
    description: (r.description as string | null) ?? null,
    impact: (r.impact as string | null) ?? null,
    dateStart: (r.date_start as string) ?? '',
    dateEnd: (r.date_end as string | null) ?? null,
    sourceType: (['human', 'meeting', 'detected'].includes(r.source_type as string)
      ? r.source_type
      : 'human') as SiteBlocage['sourceType'],
    sourceReportId: (r.source_report_id as string | null) ?? null,
    dayLogId: (r.day_log_id as string | null) ?? null,
  }
}

const SELECT =
  'id, site_id, subject_id, type, title, description, impact, date_start, date_end, source_type, source_report_id, day_log_id'

// Dégradation gracieuse si la migration 160 n'est pas encore appliquée.
function isMissingTable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return code === '42P01' || msg.includes('does not exist') || msg.includes('site_blocages')
}

/** Tous les blocages d'un site, les plus récents (date_start) d'abord. */
export async function listBlocagesBySite(siteId: string): Promise<SiteBlocage[]> {
  const { data, error } = await createAdminClient()
    .from('site_blocages')
    .select(SELECT)
    .eq('site_id', siteId)
    .order('date_start', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  return (data ?? []).map(rowToBlocage)
}

/** Blocages créés depuis ce CR (source_report_id). */
export async function listBlocagesByReport(reportId: string): Promise<SiteBlocage[]> {
  const { data, error } = await createAdminClient()
    .from('site_blocages')
    .select(SELECT)
    .eq('source_report_id', reportId)
    .order('date_start', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  return (data ?? []).map(rowToBlocage)
}

export interface CreateBlocageInput {
  siteId: string
  type: BlocageType
  title: string
  description?: string | null
  impact?: string | null
  dateStart?: string | null // défaut DB current_date si omis
  dateEnd?: string | null
  subjectId?: string | null
  sourceType?: 'human' | 'meeting' | 'detected'
  sourceReportId?: string | null
  dayLogId?: string | null
  organizationId?: string | null
  createdBy?: string | null
}

export async function createSiteBlocage(input: CreateBlocageInput): Promise<string> {
  const row: Record<string, unknown> = {
    site_id: input.siteId,
    organization_id: input.organizationId ?? null,
    subject_id: input.subjectId || null,
    type: input.type,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    impact: input.impact?.trim() || null,
    date_end: input.dateEnd || null,
    source_type: input.sourceType ?? 'human',
    source_report_id: input.sourceReportId || null,
    day_log_id: input.dayLogId || null,
    created_by: input.createdBy ?? null,
  }
  // date_start : on OMET le champ si absent → laisse le défaut DB (current_date),
  // plutôt que d'envoyer null (qui violerait le not-null).
  if (input.dateStart) row.date_start = input.dateStart
  const { data, error } = await createAdminClient()
    .from('site_blocages')
    .insert(row)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export interface UpdateBlocagePatch {
  type?: BlocageType
  title?: string
  description?: string | null
  impact?: string | null
  dateStart?: string
  dateEnd?: string | null
  subjectId?: string | null
}

/** Édition scopée au site (garde-fou : on ne modifie qu'un blocage de son org). */
export async function updateSiteBlocage(
  siteId: string,
  id: string,
  patch: UpdateBlocagePatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.type !== undefined) row.type = patch.type
  if (patch.title !== undefined) row.title = patch.title.trim()
  if (patch.description !== undefined) row.description = patch.description?.trim() || null
  if (patch.impact !== undefined) row.impact = patch.impact?.trim() || null
  if (patch.dateStart !== undefined) row.date_start = patch.dateStart
  if (patch.dateEnd !== undefined) row.date_end = patch.dateEnd || null
  if (patch.subjectId !== undefined) row.subject_id = patch.subjectId || null
  const { error } = await createAdminClient()
    .from('site_blocages')
    .update(row)
    .eq('id', id)
    .eq('site_id', siteId)
  if (error) throw new Error(error.message)
}

export async function deleteSiteBlocage(siteId: string, id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('site_blocages')
    .delete()
    .eq('id', id)
    .eq('site_id', siteId)
  if (error) throw new Error(error.message)
}

/**
 * Projection PURE vers la timeline (mémoire du lieu). Testable sans Supabase.
 *
 * Doctrine : le blocage est un ÉVÉNEMENT de contexte. EN COURS (date_end null) =
 * saillant ; résolu = trace atténuée mais CONSERVÉE (preuve datée). Aucun score,
 * aucune imputation — on décrit le fait, jamais la faute.
 */
export function blocagesToMemoryEvents(blocages: SiteBlocage[]): SiteMemoryEvent[] {
  return blocages.map((b) => {
    const ongoing = b.dateEnd === null
    const periode = b.dateEnd && b.dateEnd !== b.dateStart ? `${b.dateStart} → ${b.dateEnd}` : null
    const detail =
      [BLOCAGE_TYPE_LABEL[b.type], b.impact, ongoing ? 'en cours' : periode]
        .filter(Boolean)
        .join(' · ') || null
    return {
      type: 'blocage',
      id: `blocage-${b.id}`,
      // date civile → minuit UTC : à Nouméa (UTC+11) reste le même jour civil.
      occurredAt: `${b.dateStart}T00:00:00.000Z`,
      title: b.title,
      detail,
      status: ongoing ? 'ongoing' : 'resolved',
      meta: {
        blocageType: b.type,
        ...(b.dayLogId ? { dayLogId: b.dayLogId } : {}),
        ...(ongoing ? { ongoing: true } : {}),
      },
    }
  })
}
