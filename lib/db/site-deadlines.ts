import 'server-only'

// ── ÉCHÉANCES CHANTIER (mig 215) ─────────────────────────────────────────────
// Une échéance = ce qui doit arriver, et le temps qui va avec. Deux formes du
// « quand », jamais confondues : une DATE dite, ou une CONTRAINTE dite.
//
// Une échéance sans date n'est pas incomplète : elle est « à planifier ». C'est un
// état de travail normal — le conducteur a confirmé que le sujet existe, il n'a pas
// encore décidé du jour. On ne lui arrache pas une date pour faire joli.

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'

export type DeadlineStatus = 'to_plan' | 'planned' | 'done' | 'cancelled'

export interface SiteDeadline {
  id: string
  site_id: string
  report_id: string | null
  title: string
  /** La contrainte DITE (« Avant le démarrage »). Jamais une date déduite. */
  constraint_text: string | null
  /** null = à planifier. */
  due_date: string | null
  status: DeadlineStatus
  created_at: string
}

export async function createSiteDeadline(input: {
  site_id: string
  report_id?: string | null
  organization_id?: string | null
  title: string
  constraint_text?: string | null
  due_date?: string | null
  created_by?: string | null
  created_from?: string | null
}): Promise<string> {
  // La date décide de l'état : datée → elle vit dans le planning ; sinon elle
  // attend une décision. Aucun autre chemin — l'état ne se contredit pas avec la donnée.
  const status: DeadlineStatus = input.due_date ? 'planned' : 'to_plan'
  const { data, error } = await createAdminClient()
    .from('site_deadlines')
    .insert({
      site_id: input.site_id,
      report_id: input.report_id ?? null,
      organization_id: input.organization_id ?? null,
      title: input.title,
      constraint_text: input.constraint_text?.trim() || null,
      due_date: input.due_date ?? null,
      status,
      created_by: input.created_by ?? null,
      created_from: input.created_from ?? 'manual',
    })
    .select('id')
    .single()
  if (error) throw error
  invalidateSiteProjection(input.site_id)
  return (data as { id: string }).id
}

/** Les échéances vivantes d'un chantier : à planifier + planifiées. */
export async function listSiteDeadlines(siteId: string): Promise<SiteDeadline[]> {
  const { data, error } = await createAdminClient()
    .from('site_deadlines')
    .select('id, site_id, report_id, title, constraint_text, due_date, status, created_at')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .in('status', ['to_plan', 'planned'])
    // Les non datées en dernier : `nullsFirst: false` — « à planifier » n'est pas
    // « urgent », c'est « pas encore décidé ».
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) return []
  return (data ?? []) as SiteDeadline[]
}

/** Datée par un humain : l'échéance quitte « à planifier » pour le planning. */
export async function planSiteDeadline(id: string, dueDate: string): Promise<string | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('site_deadlines')
    .update({ due_date: dueDate, status: 'planned', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('site_id')
    .maybeSingle()
  if (error) throw error
  const siteId = (data as { site_id: string } | null)?.site_id ?? null
  if (siteId) invalidateSiteProjection(siteId)
  return siteId
}
