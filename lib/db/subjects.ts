// Sujets vivants (migration 124) — fil persistant qui agrège dans le temps les
// actions / réserves / décisions / documents d'un problème (« essais à la
// plaque », « fissure voile nord », « DOE »). Un sujet POINTE vers l'existant,
// il ne duplique rien. JAMAIS une personne (anti-RH).
//
// Criticité DÉRIVÉE (déterministe, discrète) — jamais un champ libre ni un
// jugement IA. Statut open→dormant→closed (manuel au MVP).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { listDocumentsForTarget } from '@/lib/db/documents'
import type { DbSubject, SubjectStatus, DbSiteAction, DbSiteReportProposal } from '@/types/db'

export type SubjectCriticality = 'basse' | 'moyenne' | 'haute'

export interface SubjectReserveLite {
  id: string; label: string; status: string; issuedOn: string | null
}
export interface SubjectDocLite { id: string; filename: string }

export interface SubjectSummary {
  id: string
  name: string
  status: SubjectStatus
  scopeId: string | null
  openActions: number
  lateActions: number
  openReserves: number
  decisions: number
  documents: number
  lastActivity: string | null
  criticality: SubjectCriticality
}

export interface SubjectThread {
  subject: DbSubject
  actions: DbSiteAction[]
  reserves: SubjectReserveLite[]
  decisions: DbSiteReportProposal[]
  documents: SubjectDocLite[]
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Criticité dérivée : haute si retard/réserve ouverte, moyenne si actif, basse sinon. */
function deriveCriticality(s: { lateActions: number; openReserves: number; lastActivity: string | null }): SubjectCriticality {
  if (s.lateActions > 0 || s.openReserves > 0) return 'haute'
  if (s.lastActivity && Date.now() - new Date(s.lastActivity).getTime() < 30 * 86_400_000) return 'moyenne'
  return 'basse'
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export async function createSubject(input: {
  siteId: string
  name: string
  scopeId: string | null
  userId: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const organization_id = await getOrgId().catch(() => null)
  const { data, error } = await supabase
    .from('subjects')
    .insert({
      organization_id,
      site_id: input.siteId,
      scope_id: input.scopeId,
      name: input.name,
      status: 'open',
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id as string
}

export async function setSubjectStatus(id: string, status: SubjectStatus): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('subjects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Rattache (ou détache si subjectId=null) un objet à un sujet. */
export async function attachToSubject(
  table: 'site_actions' | 'site_reserve' | 'site_report_proposals',
  rowId: string,
  subjectId: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from(table).update({ subject_id: subjectId }).eq('id', rowId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function getSubject(id: string): Promise<DbSubject | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('subjects').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return data as DbSubject
}

/** Sujets d'un site avec compteurs + dernière activité + criticité dérivée.
 *  Batché (pas de N+1) : un fetch par type d'objet, agrégation en JS. */
export async function listSubjectsBySite(siteId: string): Promise<SubjectSummary[]> {
  const supabase = createAdminClient()
  const { data: subjectsRows } = await supabase
    .from('subjects')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
  const subjects = (subjectsRows ?? []) as DbSubject[]
  if (subjects.length === 0) return []

  const ids = subjects.map((s) => s.id)
  const today = todayIso()

  const [{ data: actions }, { data: reserves }, { data: decisions }, { data: docLinks }] = await Promise.all([
    supabase.from('site_actions').select('subject_id, status, due_date, created_at').in('subject_id', ids),
    supabase.from('site_reserve').select('subject_id, status, created_at').in('subject_id', ids),
    supabase.from('site_report_proposals').select('subject_id, created_at').in('subject_id', ids),
    supabase.from('document_links').select('target_id, created_at').eq('target_type', 'subject').in('target_id', ids),
  ])

  type Agg = { openActions: number; lateActions: number; openReserves: number; decisions: number; documents: number; lastActivity: string | null }
  const agg = new Map<string, Agg>(ids.map((id) => [id, { openActions: 0, lateActions: 0, openReserves: 0, decisions: 0, documents: 0, lastActivity: null }]))
  const bump = (id: string | null, at: string | null) => {
    if (!id) return
    const a = agg.get(id); if (!a) return
    if (at && (!a.lastActivity || at > a.lastActivity)) a.lastActivity = at
  }
  for (const r of (actions ?? []) as Array<{ subject_id: string | null; status: string; due_date: string | null; created_at: string }>) {
    const a = agg.get(r.subject_id ?? ''); if (!a) continue
    if (r.status === 'open' || r.status === 'planned') {
      a.openActions += 1
      if (r.due_date != null && r.due_date < today) a.lateActions += 1
    }
    bump(r.subject_id, r.created_at)
  }
  for (const r of (reserves ?? []) as Array<{ subject_id: string | null; status: string; created_at: string }>) {
    const a = agg.get(r.subject_id ?? ''); if (!a) continue
    if (r.status === 'open') a.openReserves += 1
    bump(r.subject_id, r.created_at)
  }
  for (const r of (decisions ?? []) as Array<{ subject_id: string | null; created_at: string }>) {
    const a = agg.get(r.subject_id ?? ''); if (!a) continue
    a.decisions += 1
    bump(r.subject_id, r.created_at)
  }
  for (const r of (docLinks ?? []) as Array<{ target_id: string; created_at: string }>) {
    const a = agg.get(r.target_id); if (!a) continue
    a.documents += 1
    bump(r.target_id, r.created_at)
  }

  return subjects.map((s) => {
    const a = agg.get(s.id)!
    const lastActivity = a.lastActivity && a.lastActivity > s.updated_at ? a.lastActivity : s.updated_at
    return {
      id: s.id, name: s.name, status: s.status, scopeId: s.scope_id,
      openActions: a.openActions, lateActions: a.lateActions, openReserves: a.openReserves,
      decisions: a.decisions, documents: a.documents, lastActivity,
      criticality: deriveCriticality({ lateActions: a.lateActions, openReserves: a.openReserves, lastActivity }),
    }
  })
}

/** Fil complet d'un sujet : actions + réserves + décisions + documents. */
export async function getSubjectThread(subjectId: string): Promise<SubjectThread | null> {
  const subject = await getSubject(subjectId)
  if (!subject) return null
  const supabase = createAdminClient()

  const [{ data: actions }, { data: reserves }, { data: decisions }, documents] = await Promise.all([
    supabase.from('site_actions').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    supabase.from('site_reserve').select('id, label, status, issued_on').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    supabase.from('site_report_proposals').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    listDocumentsForTarget('subject', subjectId).catch(() => []),
  ])

  return {
    subject,
    actions: (actions ?? []) as DbSiteAction[],
    reserves: ((reserves ?? []) as Array<{ id: string; label: string; status: string; issued_on: string | null }>)
      .map((r) => ({ id: r.id, label: r.label, status: r.status, issuedOn: r.issued_on })),
    decisions: (decisions ?? []) as DbSiteReportProposal[],
    documents: documents.map((d) => ({ id: d.id, filename: d.filename })),
  }
}
