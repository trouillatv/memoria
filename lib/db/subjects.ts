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

export interface SubjectDecisionLite { id: string; titre: string; statut: string; dateDecision: string | null }
export interface SubjectThread {
  subject: DbSubject
  actions: DbSiteAction[]
  reserves: SubjectReserveLite[]
  decisions: DbSiteReportProposal[]
  siteDecisions: SubjectDecisionLite[]
  documents: SubjectDocLite[]
}

// HISTOIRE du sujet (Vincent : « un sujet = l'histoire complète d'un problème, pas
// une liste d'occurrences »). Un événement = un objet rattaché, daté, situé à sa réunion.
export type SubjectEventKind = 'decision' | 'action' | 'reserve' | 'cr_decision' | 'document'
export interface SubjectEvent {
  date: string                 // ISO (tri + affichage)
  kind: SubjectEventKind
  label: string
  meta: string | null
  reportLabel: string | null   // « Réunion du JJ/MM » si rattaché à un CR
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
function ddmmyyyy(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86400000)
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
  table: 'site_actions' | 'site_reserve' | 'site_report_proposals' | 'site_decisions',
  rowId: string,
  subjectId: string | null,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from(table).update({ subject_id: subjectId }).eq('id', rowId)
  if (error) throw error
}

/** Trouve (insensible à la casse, dans le site) ou crée un sujet par son nom. C'est le
 *  PONT de peuplement : le champ `sujet` d'une décision devient une entité Subject. */
export async function findOrCreateSubjectByName(siteId: string, name: string, userId: string | null): Promise<string> {
  const clean = name.trim()
  if (!clean) throw new Error('Nom de sujet vide.')
  const supabase = createAdminClient()
  const { data } = await supabase.from('subjects').select('id').eq('site_id', siteId).ilike('name', clean).limit(1).maybeSingle()
  if (data?.id) return data.id as string
  return createSubject({ siteId, name: clean, scopeId: null, userId })
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

  const [{ data: actions }, { data: reserves }, { data: decisions }, { data: siteDecisions }, documents] = await Promise.all([
    supabase.from('site_actions').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    supabase.from('site_reserve').select('id, label, status, issued_on').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    supabase.from('site_report_proposals').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    supabase.from('site_decisions').select('id, titre, statut, date_decision').eq('subject_id', subjectId).order('date_decision', { ascending: false }),
    listDocumentsForTarget('subject', subjectId).catch(() => []),
  ])

  return {
    subject,
    actions: (actions ?? []) as DbSiteAction[],
    reserves: ((reserves ?? []) as Array<{ id: string; label: string; status: string; issued_on: string | null }>)
      .map((r) => ({ id: r.id, label: r.label, status: r.status, issuedOn: r.issued_on })),
    decisions: (decisions ?? []) as DbSiteReportProposal[],
    siteDecisions: ((siteDecisions ?? []) as Array<{ id: string; titre: string; statut: string; date_decision: string | null }>)
      .map((d) => ({ id: d.id, titre: d.titre, statut: d.statut, dateDecision: d.date_decision })),
    documents: documents.map((d) => ({ id: d.id, filename: d.filename })),
  }
}

// EXPLOITATION du sujet (Vincent P3 « Sujet vivant ») — synthèse DÉTERMINISTE de
// l'histoire : âge, réunions concernées, promesses (échéances annoncées dans le temps),
// reports (glissements vers plus tard), récurrence. Zéro IA, zéro score d'acteur.
export interface SubjectPromise { announcedOn: string; dueDate: string; label: string }
export interface SubjectInsights {
  ageDays: number | null
  meetingsCount: number
  decisionsCount: number
  openActions: number
  promises: SubjectPromise[]
  lastPromise: string | null
  slippages: number       // nb de fois où l'échéance a glissé PLUS TARD = « reports »
  recurring: boolean      // sujet OUVERT concerné par ≥ seuil réunions
  status: SubjectStatus
}

export async function getSubjectInsights(subjectId: string, recurringMeetings = 3): Promise<SubjectInsights | null> {
  const subject = await getSubject(subjectId)
  if (!subject) return null
  const supabase = createAdminClient()
  const today = todayIso()
  const [{ data: decisions }, { data: actions }] = await Promise.all([
    supabase.from('site_decisions').select('titre, date_decision, echeance, report_id, statut').eq('subject_id', subjectId),
    supabase.from('site_actions').select('title, created_at, due_date, report_id, status').eq('subject_id', subjectId),
  ])
  const decs = decisions ?? []
  const acts = actions ?? []

  const reportIds = new Set<string>()
  for (const d of decs) if (d.report_id) reportIds.add(d.report_id as string)
  for (const a of acts) if (a.report_id) reportIds.add(a.report_id as string)

  // PROMESSES = échéances ANNONCÉES dans le temps (décision.echeance, action.due_date),
  // ordonnées par date d'annonce. « DOE promis 12/03, 28/03, 14/04… ».
  const promises: SubjectPromise[] = []
  for (const d of decs) if (d.echeance) promises.push({ announcedOn: (d.date_decision as string) ?? '', dueDate: d.echeance as string, label: d.titre as string })
  for (const a of acts) if (a.due_date) promises.push({ announcedOn: (a.created_at as string).slice(0, 10), dueDate: a.due_date as string, label: a.title as string })
  promises.sort((x, y) => x.announcedOn.localeCompare(y.announcedOn))
  // Reports : à chaque nouvelle promesse, l'échéance recule encore = glissement.
  let slippages = 0
  for (let i = 1; i < promises.length; i++) if (promises[i].dueDate > promises[i - 1].dueDate) slippages++
  const lastPromise = promises.length ? promises[promises.length - 1].dueDate : null

  // Âge = depuis le 1er événement daté.
  const firstDates = [
    ...decs.map((d) => d.date_decision as string | null),
    ...acts.map((a) => (a.created_at as string).slice(0, 10)),
  ].filter((x): x is string => !!x).sort()
  const ageDays = firstDates.length ? daysBetween(firstDates[0], today) : null

  const openActions = acts.filter((a) => a.status === 'open' || a.status === 'planned').length
  return {
    ageDays: ageDays != null && ageDays >= 0 ? ageDays : null,
    meetingsCount: reportIds.size,
    decisionsCount: decs.length,
    openActions,
    promises,
    lastPromise,
    slippages,
    recurring: subject.status === 'open' && reportIds.size >= recurringMeetings,
    status: subject.status,
  }
}

/** HISTORIQUE CHRONOLOGIQUE d'un sujet — l'histoire complète, tous objets fusionnés et
 *  datés, situés à leur réunion (Vincent : « CR12 décision · CR14 promesse · … »). */
export async function getSubjectTimeline(subjectId: string): Promise<SubjectEvent[]> {
  const supabase = createAdminClient()
  const [{ data: decisions }, { data: actions }, { data: reserves }, { data: crDecisions }, documents] = await Promise.all([
    supabase.from('site_decisions').select('id, titre, statut, date_decision, echeance, report_id').eq('subject_id', subjectId),
    supabase.from('site_actions').select('id, title, status, due_date, created_at, report_id').eq('subject_id', subjectId),
    supabase.from('site_reserve').select('id, label, status, issued_on').eq('subject_id', subjectId),
    supabase.from('site_report_proposals').select('id, short_label, created_at, report_id').eq('subject_id', subjectId),
    listDocumentsForTarget('subject', subjectId).catch(() => []),
  ])

  // Résolution des réunions concernées (report_id → « Réunion du JJ/MM »), en lot.
  const reportIds = [
    ...(decisions ?? []).map((r) => r.report_id as string | null),
    ...(actions ?? []).map((r) => r.report_id as string | null),
    ...(crDecisions ?? []).map((r) => r.report_id as string | null),
  ].filter((x): x is string => !!x)
  const reportLabel = new Map<string, string>()
  if (reportIds.length > 0) {
    const { data: reps } = await supabase.from('site_reports').select('id, created_at, title').in('id', [...new Set(reportIds)])
    for (const r of reps ?? []) reportLabel.set(r.id as string, (r.title as string | null)?.trim() || `Réunion du ${ddmmyyyy(r.created_at as string)}`)
  }
  const repOf = (id: string | null) => (id ? reportLabel.get(id) ?? null : null)

  const events: SubjectEvent[] = []
  for (const d of decisions ?? []) {
    events.push({ date: (d.date_decision as string) ?? (d.report_id ? '' : ''), kind: 'decision', label: d.titre as string,
      meta: [`décision (${d.statut})`, d.echeance ? `échéance ${ddmmyyyy(d.echeance as string)}` : null].filter(Boolean).join(' · '), reportLabel: repOf(d.report_id as string | null) })
  }
  for (const a of actions ?? []) {
    events.push({ date: (a.created_at as string).slice(0, 10), kind: 'action', label: a.title as string,
      meta: [`action (${a.status})`, a.due_date ? `échéance ${ddmmyyyy(a.due_date as string)}` : null].filter(Boolean).join(' · '), reportLabel: repOf(a.report_id as string | null) })
  }
  for (const r of reserves ?? []) {
    events.push({ date: (r.issued_on as string) ?? '', kind: 'reserve', label: r.label as string, meta: `réserve (${r.status})`, reportLabel: null })
  }
  for (const c of crDecisions ?? []) {
    events.push({ date: (c.created_at as string).slice(0, 10), kind: 'cr_decision', label: c.short_label as string, meta: 'décision (CR)', reportLabel: repOf(c.report_id as string | null) })
  }
  for (const doc of documents) {
    const at = (doc as { created_at?: string }).created_at
    events.push({ date: at ? at.slice(0, 10) : '', kind: 'document', label: (doc as { filename?: string }).filename ?? 'Document', meta: 'document', reportLabel: null })
  }
  // Ordre CHRONOLOGIQUE (du plus ancien au plus récent) = l'histoire qui se déroule.
  return events.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date))
}
