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
export interface SubjectAnomalyLite { id: string; label: string; open: boolean }
export interface SubjectThread {
  subject: DbSubject
  actions: DbSiteAction[]
  reserves: SubjectReserveLite[]
  decisions: DbSiteReportProposal[]
  siteDecisions: SubjectDecisionLite[]
  anomalies: SubjectAnomalyLite[]
  documents: SubjectDocLite[]
}

// HISTOIRE du sujet (Vincent : « un sujet = l'histoire complète d'un problème, pas
// une liste d'occurrences »). Un événement = un objet rattaché, daté, situé à sa réunion.
export type SubjectEventKind = 'decision' | 'action' | 'reserve' | 'cr_decision' | 'anomaly' | 'document'
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
  table: 'site_actions' | 'site_reserve' | 'site_report_proposals' | 'site_decisions' | 'intervention_anomalies' | 'report_added_points',
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

  const [{ data: actions }, { data: reserves }, { data: decisions }, { data: siteDecisions }, { data: anomI }, { data: anomA }, documents] = await Promise.all([
    supabase.from('site_actions').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    supabase.from('site_reserve').select('id, label, status, issued_on').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    supabase.from('site_report_proposals').select('*').eq('subject_id', subjectId).order('created_at', { ascending: false }),
    supabase.from('site_decisions').select('id, titre, statut, date_decision').eq('subject_id', subjectId).order('date_decision', { ascending: false }),
    supabase.from('intervention_anomalies').select('id, description, category_other, resolved_at').eq('subject_id', subjectId),
    supabase.from('report_added_points').select('id, label').eq('subject_id', subjectId).eq('kind', 'anomalie'),
    listDocumentsForTarget('subject', subjectId).catch(() => []),
  ])

  const anomalies: SubjectAnomalyLite[] = [
    ...((anomI ?? []) as Array<{ id: string; description: string | null; category_other: string | null; resolved_at: string | null }>)
      .map((a) => ({ id: a.id, label: (a.description ?? a.category_other ?? '').trim() || '(anomalie)', open: a.resolved_at == null })),
    ...((anomA ?? []) as Array<{ id: string; label: string }>).map((a) => ({ id: a.id, label: a.label, open: true })),
  ]

  return {
    subject,
    actions: (actions ?? []) as DbSiteAction[],
    reserves: ((reserves ?? []) as Array<{ id: string; label: string; status: string; issued_on: string | null }>)
      .map((r) => ({ id: r.id, label: r.label, status: r.status, issuedOn: r.issued_on })),
    decisions: (decisions ?? []) as DbSiteReportProposal[],
    siteDecisions: ((siteDecisions ?? []) as Array<{ id: string; titre: string; statut: string; date_decision: string | null }>)
      .map((d) => ({ id: d.id, titre: d.titre, statut: d.statut, dateDecision: d.date_decision })),
    anomalies,
    documents: documents.map((d) => ({ id: d.id, filename: d.filename })),
  }
}

// EXPLOITATION du sujet (Vincent P3 « Sujet vivant ») — synthèse DÉTERMINISTE de
// l'histoire : âge, réunions concernées, promesses (échéances annoncées dans le temps),
// reports (glissements vers plus tard), récurrence. Zéro IA, zéro score d'acteur.
export interface SubjectDeadline { announcedOn: string; dueDate: string; label: string }
// ÉTAT INTELLIGENT du sujet (Vincent : « la réunion raconte ce qui s'est passé, le
// sujet raconte ce qui se passe »). Tout DÉRIVÉ, déterministe, zéro IA, zéro score
// d'acteur. La cause porte un niveau de CONFIANCE quand elle est déduite, pas connue.
export type SubjectState = 'ouvert' | 'en_attente' | 'bloqué' | 'dormant' | 'clos'
export type CauseConfidence = 'élevée' | 'moyenne' | 'faible'
export type SubjectEnergy = 'basse' | 'moyenne' | 'élevée' | 'très élevée'
export interface SubjectInsights {
  ageDays: number | null
  meetingsCount: number
  decisionsCount: number
  openActions: number
  // — Intelligence dérivée —
  state: SubjectState
  cause: { text: string; confidence: CauseConfidence } | null
  lastEvolution: string | null
  nextStep: string | null
  openQuestion: string | null
  energy: SubjectEnergy
  // ÉCHÉANCES ANNONCÉES (≠ « promesses » — Vincent : ne pas confondre un engagement
  // avec une date cible modifiable). On expose le FAIT : les échéances déclarées,
  // datées de leur annonce.
  deadlines: SubjectDeadline[]
  lastDeadline: string | null
  // REPORTS = nb de fois où une échéance PLUS TARDIVE a été RÉ-ANNONCÉE à une date
  // ultérieure (vrai recul dans le temps), pas une simple édition le même jour.
  slippages: number
  recurring: boolean      // sujet OUVERT concerné par ≥ seuil réunions
  status: SubjectStatus
}

type SubjRow = Record<string, unknown>
export interface SubjectAnomaly { label: string; open: boolean }
/** Calcul PUR de l'intelligence d'un sujet (aucune DB) — réutilisé en lot (briefing). */
function computeSubjectInsights(subject: DbSubject, decs: SubjRow[], acts: SubjRow[], anoms: SubjectAnomaly[], recurringMeetings: number): SubjectInsights {
  const today = todayIso()
  const openAnoms = anoms.filter((a) => a.open && a.label.trim())

  const reportIds = new Set<string>()
  for (const d of decs) if (d.report_id) reportIds.add(d.report_id as string)
  for (const a of acts) if (a.report_id) reportIds.add(a.report_id as string)

  // ÉCHÉANCES ANNONCÉES dans le temps (décision.echeance, action.due_date), ordonnées
  // par date d'annonce. On NE les appelle PAS « promesses » (ce serait une interprétation).
  const deadlines: SubjectDeadline[] = []
  for (const d of decs) if (d.echeance && d.date_decision) deadlines.push({ announcedOn: d.date_decision as string, dueDate: d.echeance as string, label: d.titre as string })
  for (const a of acts) if (a.due_date) deadlines.push({ announcedOn: (a.created_at as string).slice(0, 10), dueDate: a.due_date as string, label: a.title as string })
  deadlines.sort((x, y) => x.announcedOn.localeCompare(y.announcedOn) || x.dueDate.localeCompare(y.dueDate))
  // REPORT = une échéance plus tardive RÉ-ANNONCÉE à une date ULTÉRIEURE. On exige une
  // nouvelle annonce (announcedOn strictement plus récent) → exclut deux échéances le
  // même jour et les éditions (qui ne changent pas la date d'annonce de l'objet).
  let slippages = 0
  let prevDue: string | null = null
  let prevAnn: string | null = null
  for (const p of deadlines) {
    if (prevDue != null && prevAnn != null && p.announcedOn > prevAnn && p.dueDate > prevDue) slippages++
    if (prevAnn == null || p.announcedOn >= prevAnn) { prevDue = p.dueDate; prevAnn = p.announcedOn }
  }
  const lastDeadline = deadlines.length ? deadlines[deadlines.length - 1].dueDate : null

  // Âge = depuis le 1er événement daté.
  const firstDates = [
    ...decs.map((d) => d.date_decision as string | null),
    ...acts.map((a) => (a.created_at as string).slice(0, 10)),
  ].filter((x): x is string => !!x).sort()
  const ageDays = firstDates.length ? daysBetween(firstDates[0], today) : null

  const openActs = acts.filter((a) => a.status === 'open' || a.status === 'planned')
  const overdue = openActs.filter((a) => a.due_date && (a.due_date as string) < today)
  const parties = [...new Set(openActs.map((a) => (a.assigned_to as string | null)?.trim()).filter((x): x is string => !!x))]
  const lastActivity = [...decs.map((d) => d.date_decision as string | null), ...acts.map((a) => (a.created_at as string).slice(0, 10))].filter((x): x is string => !!x).sort().pop() ?? null
  const dormant = lastActivity ? daysBetween(lastActivity, today) > 90 : false

  // ÉTAT (priorité : clos > bloqué(anomalie/retard) > en attente(responsable) > dormant > ouvert).
  // Une ANOMALIE NON RÉSOLUE rattachée = un vrai blocage (Vincent : « Façade Nord »).
  let state: SubjectState
  if (subject.status === 'closed') state = 'clos'
  else if (openAnoms.length > 0 || overdue.length > 0) state = 'bloqué'
  else if (parties.length > 0) state = 'en_attente'
  else if (subject.status === 'dormant' || dormant) state = 'dormant'
  else state = 'ouvert'

  // CAUSE + CONFIANCE. Les anomalies sont une cause FACTUELLE (confiance élevée) — elles
  // priment sur la déduction « en attente de … ». Sinon, déduction (confiance dégradée).
  let cause: { text: string; confidence: CauseConfidence } | null = null
  if (openAnoms.length > 0) {
    cause = { text: `Blocage : ${openAnoms.slice(0, 3).map((a) => a.label).join(', ')}${openAnoms.length > 3 ? `, +${openAnoms.length - 3}` : ''}`, confidence: 'élevée' }
  } else if (parties.length === 1) cause = { text: `En attente de ${parties[0]}`, confidence: 'élevée' }
  else if (parties.length > 1) cause = { text: `En attente de ${parties.slice(0, 3).join(', ')}`, confidence: 'moyenne' }
  else if (overdue.length > 0) cause = { text: 'Échéance dépassée — responsable non précisé', confidence: 'faible' }

  // DERNIÈRE ÉVOLUTION : un report d'échéance si détecté, sinon le dernier objet daté.
  let lastEvolution: string | null = null
  if (slippages > 0 && deadlines.length >= 2) {
    lastEvolution = `Échéance repoussée du ${ddmmyyyy(deadlines[deadlines.length - 2].dueDate)} au ${ddmmyyyy(lastDeadline)}`
  } else {
    const evs = [
      ...decs.map((d) => ({ date: d.date_decision as string | null, label: `décision : ${d.titre as string}` })),
      ...acts.map((a) => ({ date: (a.created_at as string).slice(0, 10), label: `action : ${a.title as string}` })),
    ].filter((e): e is { date: string; label: string } => !!e.date).sort((x, y) => x.date.localeCompare(y.date))
    lastEvolution = evs.length ? `${ddmmyyyy(evs[evs.length - 1].date)} — ${evs[evs.length - 1].label}` : null
  }

  // PROCHAINE ÉTAPE : l'action ouverte à échéance la plus proche (sinon la 1re en retard).
  const future = openActs.filter((a) => a.due_date && (a.due_date as string) >= today).sort((x, y) => (x.due_date as string).localeCompare(y.due_date as string))
  const pick = future[0] ?? overdue[0] ?? null
  const nextStep = pick
    ? `${pick.title as string}${pick.assigned_to ? ` — ${pick.assigned_to as string}` : ''}${pick.due_date ? ` (pour le ${ddmmyyyy(pick.due_date as string)})` : ''}`
    : null

  const openQuestion = subject.status === 'open' && lastDeadline ? `${subject.name} sera-t-il tenu pour le ${ddmmyyyy(lastDeadline)} ?` : null

  // ÉNERGIE (mémoire, PAS note d'acteur) : attention humaine que le sujet consomme.
  const ageMonths = ageDays != null && ageDays >= 0 ? ageDays / 30 : 0
  const score = ageMonths + reportIds.size + slippages * 2 + openActs.length + openAnoms.length * 2
  const energy: SubjectEnergy = score >= 12 ? 'très élevée' : score >= 7 ? 'élevée' : score >= 3 ? 'moyenne' : 'basse'

  return {
    ageDays: ageDays != null && ageDays >= 0 ? ageDays : null,
    meetingsCount: reportIds.size,
    decisionsCount: decs.length,
    openActions: openActs.length,
    state,
    cause,
    lastEvolution,
    nextStep,
    openQuestion,
    energy,
    deadlines,
    lastDeadline,
    slippages,
    recurring: subject.status === 'open' && reportIds.size >= recurringMeetings,
    status: subject.status,
  }
}

/** Anomalies d'un sujet (intervention_anomalies non résolues + anomalies saisies en
 *  séance), normalisées en { label, open } pour nourrir l'état/cause. */
function toAnomalies(intervention: SubjRow[], added: SubjRow[]): SubjectAnomaly[] {
  return [
    ...intervention.map((a) => ({ label: (((a.description as string | null) ?? (a.category_other as string | null)) ?? '').trim(), open: a.resolved_at == null })),
    ...added.map((a) => ({ label: ((a.label as string | null) ?? '').trim(), open: true })),
  ].filter((a) => a.label)
}

export async function getSubjectInsights(subjectId: string, recurringMeetings = 3): Promise<SubjectInsights | null> {
  const subject = await getSubject(subjectId)
  if (!subject) return null
  const supabase = createAdminClient()
  const [{ data: decisions }, { data: actions }, { data: anomI }, { data: anomA }] = await Promise.all([
    supabase.from('site_decisions').select('titre, date_decision, echeance, report_id, statut').eq('subject_id', subjectId),
    supabase.from('site_actions').select('title, created_at, due_date, report_id, status, assigned_to').eq('subject_id', subjectId),
    supabase.from('intervention_anomalies').select('description, category_other, resolved_at').eq('subject_id', subjectId),
    supabase.from('report_added_points').select('label, kind').eq('subject_id', subjectId).eq('kind', 'anomalie'),
  ])
  const anoms = toAnomalies((anomI ?? []) as SubjRow[], (anomA ?? []) as SubjRow[])
  return computeSubjectInsights(subject, decisions ?? [], actions ?? [], anoms, recurringMeetings)
}

export interface SubjectWatch {
  id: string; name: string; state: SubjectState; ageDays: number | null
  energy: SubjectEnergy; cause: string | null; lastEvolution: string | null; openQuestion: string | null
}
const ENERGY_RANK: Record<SubjectEnergy, number> = { basse: 0, moyenne: 1, élevée: 2, 'très élevée': 3 }

/** Sujets d'un site qui APPELLENT une action/question (pour le briefing) : bloqué,
 *  en attente, reports d'échéance, récurrence ou question ouverte. Batché (3 requêtes,
 *  pas de N+1), trié (bloqué d'abord puis énergie), capé. Ne surcharge pas le briefing. */
export async function listSiteSubjectsToWatch(siteId: string, limit = 6): Promise<SubjectWatch[]> {
  const supabase = createAdminClient()
  const { data: subs } = await supabase.from('subjects').select('*').eq('site_id', siteId).neq('status', 'closed')
  const subjects = (subs ?? []) as DbSubject[]
  if (subjects.length === 0) return []
  const ids = subjects.map((s) => s.id)
  const [{ data: decisions }, { data: actions }, { data: anomI }, { data: anomA }] = await Promise.all([
    supabase.from('site_decisions').select('subject_id, titre, date_decision, echeance, report_id, statut').in('subject_id', ids),
    supabase.from('site_actions').select('subject_id, title, created_at, due_date, report_id, status, assigned_to').in('subject_id', ids),
    supabase.from('intervention_anomalies').select('subject_id, description, category_other, resolved_at').in('subject_id', ids),
    supabase.from('report_added_points').select('subject_id, label, kind').in('subject_id', ids).eq('kind', 'anomalie'),
  ])
  const decBy = new Map<string, SubjRow[]>()
  for (const d of (decisions ?? []) as SubjRow[]) { const k = d.subject_id as string; const a = decBy.get(k); if (a) a.push(d); else decBy.set(k, [d]) }
  const actBy = new Map<string, SubjRow[]>()
  for (const a of (actions ?? []) as SubjRow[]) { const k = a.subject_id as string; const arr = actBy.get(k); if (arr) arr.push(a); else actBy.set(k, [a]) }
  const anomBy = new Map<string, SubjRow[]>()
  for (const a of [...((anomI ?? []) as SubjRow[]), ...((anomA ?? []) as SubjRow[])]) { const k = a.subject_id as string; const arr = anomBy.get(k); if (arr) arr.push(a); else anomBy.set(k, [a]) }

  return subjects
    .map((s) => {
      const raw = anomBy.get(s.id) ?? []
      const anoms = toAnomalies(raw.filter((r) => 'description' in r || 'category_other' in r), raw.filter((r) => 'kind' in r))
      return { s, ins: computeSubjectInsights(s, decBy.get(s.id) ?? [], actBy.get(s.id) ?? [], anoms, 3) }
    })
    .filter(({ ins }) => ins.state === 'bloqué' || ins.state === 'en_attente' || ins.slippages > 0 || ins.recurring || ins.openQuestion != null)
    .sort((a, b) => (a.ins.state === 'bloqué' ? 0 : 1) - (b.ins.state === 'bloqué' ? 0 : 1) || ENERGY_RANK[b.ins.energy] - ENERGY_RANK[a.ins.energy])
    .slice(0, limit)
    .map(({ s, ins }) => ({ id: s.id, name: s.name, state: ins.state, ageDays: ins.ageDays, energy: ins.energy, cause: ins.cause?.text ?? null, lastEvolution: ins.lastEvolution, openQuestion: ins.openQuestion }))
}

/** HISTORIQUE CHRONOLOGIQUE d'un sujet — l'histoire complète, tous objets fusionnés et
 *  datés, situés à leur réunion (Vincent : « CR12 décision · CR14 promesse · … »). */
export async function getSubjectTimeline(subjectId: string): Promise<SubjectEvent[]> {
  const supabase = createAdminClient()
  const [{ data: decisions }, { data: actions }, { data: reserves }, { data: crDecisions }, { data: anomI }, { data: anomA }, documents] = await Promise.all([
    supabase.from('site_decisions').select('id, titre, statut, date_decision, echeance, report_id').eq('subject_id', subjectId),
    supabase.from('site_actions').select('id, title, status, due_date, created_at, report_id').eq('subject_id', subjectId),
    supabase.from('site_reserve').select('id, label, status, issued_on').eq('subject_id', subjectId),
    supabase.from('site_report_proposals').select('id, short_label, created_at, report_id').eq('subject_id', subjectId),
    supabase.from('intervention_anomalies').select('id, description, category_other, resolved_at, created_at').eq('subject_id', subjectId),
    supabase.from('report_added_points').select('id, label, created_at, report_id').eq('subject_id', subjectId).eq('kind', 'anomalie'),
    listDocumentsForTarget('subject', subjectId).catch(() => []),
  ])

  // Résolution des réunions concernées (report_id → « Réunion du JJ/MM »), en lot.
  const reportIds = [
    ...(decisions ?? []).map((r) => r.report_id as string | null),
    ...(actions ?? []).map((r) => r.report_id as string | null),
    ...(crDecisions ?? []).map((r) => r.report_id as string | null),
    ...(anomA ?? []).map((r) => r.report_id as string | null),
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
  for (const an of anomI ?? []) {
    events.push({ date: (an.created_at as string | null)?.slice(0, 10) ?? '', kind: 'anomaly', label: ((an.description as string | null) ?? (an.category_other as string | null) ?? '(anomalie)').trim(),
      meta: an.resolved_at ? 'anomalie (résolue)' : 'anomalie (non résolue)', reportLabel: null })
  }
  for (const an of anomA ?? []) {
    events.push({ date: (an.created_at as string | null)?.slice(0, 10) ?? '', kind: 'anomaly', label: (an.label as string) ?? '(anomalie)', meta: 'anomalie signalée en séance', reportLabel: repOf(an.report_id as string | null) })
  }
  for (const doc of documents) {
    const at = (doc as { created_at?: string }).created_at
    events.push({ date: at ? at.slice(0, 10) : '', kind: 'document', label: (doc as { filename?: string }).filename ?? 'Document', meta: 'document', reportLabel: null })
  }
  // Ordre CHRONOLOGIQUE (du plus ancien au plus récent) = l'histoire qui se déroule.
  return events.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date))
}
