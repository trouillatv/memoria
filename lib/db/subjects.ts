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
import { getSubjectImpactCounts, type SubjectImpact } from '@/lib/db/subject-relations'
import { normalizeSubjectName, subjectDedupKey } from '@/lib/db/subject-doctrine'
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
export type SubjectEventKind = 'decision' | 'action' | 'reserve' | 'cr_decision' | 'anomaly' | 'document' | 'obligation' | 'origin' | 'knowledge' | 'capture'
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
      name: normalizeSubjectName(input.name), // forme canonique à l'écriture (anti-doublon)
      status: 'open',
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id')
  return data.id as string
}

/** Sujet existant du site dont le nom est identique (normalisé, insensible casse).
 *  Base de l'anti-doublon : un même objet métier ne doit pas exister en double. */
export async function findSubjectByName(siteId: string, name: string): Promise<{ id: string; name: string } | null> {
  const key = subjectDedupKey(name)
  if (!key) return null
  const supabase = createAdminClient()
  const { data } = await supabase.from('subjects').select('id, name').eq('site_id', siteId)
  for (const s of (data ?? []) as { id: string; name: string }[]) {
    if (subjectDedupKey(s.name) === key) return s
  }
  return null
}

export async function setSubjectStatus(id: string, status: SubjectStatus): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('subjects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Renomme un point suivi (forme canonique). L'anti-doublon est vérifié côté action. */
export async function renameSubject(id: string, name: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('subjects')
    .update({ name: normalizeSubjectName(name), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Rattache (ou détache si subjectId=null) un objet à un sujet. */
export async function attachToSubject(
  table: 'site_actions' | 'site_reserve' | 'site_report_proposals' | 'site_decisions' | 'intervention_anomalies' | 'report_added_points' | 'site_obligation',
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
  const clean = normalizeSubjectName(name)
  if (!clean) throw new Error('Nom de sujet vide.')
  const existing = await findSubjectByName(siteId, clean)
  if (existing) return existing.id
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
  openReserves: number
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
  // IMPACT (migration 145) : combien de sujets CE sujet bloque, et si l'un de ces
  // blocages est critique. Dérivé de subject_relation. Amplifie l'attention, pas un score.
  blocksCount: number
  criticalImpact: boolean
}

type SubjRow = Record<string, unknown>
export interface SubjectAnomaly { label: string; open: boolean }
// Décisions CR (propositions) ACTIONNABLES restées lettre morte = un type qui appelle
// une exécution (action/intervention/mission), non rejeté, et sans entité créée. Une
// telle décision « action attendue non suivie » empêche un sujet de paraître neutre.
const ACTIONABLE_PROPOSAL_TYPES = new Set(['action', 'intervention', 'mission'])
/** Calcul PUR de l'intelligence d'un sujet (aucune DB) — réutilisé en lot (briefing).
 *  Absorbe TOUT ce qui est rattaché au fil : décisions, actions, anomalies, RÉSERVES et
 *  décisions CR. Un objet visible dans le fil mais ignoré ici = un état/cause qui ment. */
function computeSubjectInsights(subject: DbSubject, decs: SubjRow[], acts: SubjRow[], anoms: SubjectAnomaly[], reserves: SubjRow[], crProps: SubjRow[], recurringMeetings: number, impact: SubjectImpact = { blocksCount: 0, criticalImpact: false }): SubjectInsights {
  const today = todayIso()
  const openAnoms = anoms.filter((a) => a.open && a.label.trim())
  // RÉSERVE non levée (status 'open' — jamais « résolue », cf. doctrine juridique) = un
  // vrai blocage au même titre qu'une anomalie : la réception n'est pas prononcée.
  const openReserves = reserves
    .filter((r) => (r.status as string) === 'open')
    .map((r) => ({ label: ((r.label as string | null) ?? '').trim() }))
    .filter((r) => r.label)
  // BLOQUEURS FACTUELS = anomalies non résolues + réserves non levées (cause connue, élevée).
  const blockers = [...openAnoms.map((a) => ({ label: a.label.trim() })), ...openReserves]
  // Décisions CR actionnables sans suite d'effet.
  const pendingCr = crProps.filter((p) =>
    ACTIONABLE_PROPOSAL_TYPES.has(p.type as string) && (p.status as string) !== 'rejected' && p.created_entity_id == null)

  const reportIds = new Set<string>()
  for (const d of decs) if (d.report_id) reportIds.add(d.report_id as string)
  for (const a of acts) if (a.report_id) reportIds.add(a.report_id as string)
  for (const p of crProps) if (p.report_id) reportIds.add(p.report_id as string)

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

  // ÉTAT (priorité : clos > bloqué(blocage/retard) > en attente(responsable/décision CR sans
  // suite) > dormant > ouvert). Un BLOQUEUR = anomalie non résolue OU réserve non levée
  // (Vincent : « Façade Nord »). Une décision CR actionnable sans suite empêche le neutre.
  let state: SubjectState
  if (subject.status === 'closed') state = 'clos'
  else if (blockers.length > 0 || overdue.length > 0) state = 'bloqué'
  else if (parties.length > 0 || pendingCr.length > 0) state = 'en_attente'
  else if (subject.status === 'dormant' || dormant) state = 'dormant'
  else state = 'ouvert'

  // CAUSE + CONFIANCE. Les bloqueurs (anomalies + réserves) sont une cause FACTUELLE
  // (confiance élevée) — ils priment sur la déduction « en attente de … ». Une décision CR
  // sans suite est une cause moyenne (le suivi manque, le responsable n'est pas certain).
  let cause: { text: string; confidence: CauseConfidence } | null = null
  if (blockers.length > 0) {
    cause = { text: `Blocage : ${blockers.slice(0, 3).map((b) => b.label).join(', ')}${blockers.length > 3 ? `, +${blockers.length - 3}` : ''}`, confidence: 'élevée' }
  } else if (parties.length === 1) cause = { text: `En attente de ${parties[0]}`, confidence: 'élevée' }
  else if (parties.length > 1) cause = { text: `En attente de ${parties.slice(0, 3).join(', ')}`, confidence: 'moyenne' }
  else if (pendingCr.length > 0) {
    const lbl = ((pendingCr[0].short_label as string | null) ?? '').trim()
    cause = { text: `Décision CR sans suite${lbl ? ` : ${lbl}` : ''}`, confidence: 'moyenne' }
  } else if (overdue.length > 0) cause = { text: 'Échéance dépassée — responsable non précisé', confidence: 'faible' }

  // DERNIÈRE ÉVOLUTION : un report d'échéance si détecté, sinon le dernier objet daté.
  let lastEvolution: string | null = null
  if (slippages > 0 && deadlines.length >= 2) {
    lastEvolution = `Échéance repoussée du ${ddmmyyyy(deadlines[deadlines.length - 2].dueDate)} au ${ddmmyyyy(lastDeadline)}`
  } else {
    const evs = [
      ...decs.map((d) => ({ date: d.date_decision as string | null, label: `décision : ${d.titre as string}` })),
      ...acts.map((a) => ({ date: (a.created_at as string).slice(0, 10), label: `action : ${a.title as string}` })),
      ...crProps.map((p) => ({ date: (p.created_at as string | null)?.slice(0, 10) ?? null, label: `décision CR : ${p.short_label as string}` })),
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
  // Réserves non levées pèsent comme les anomalies (×2, vrais blocages) ; décisions CR
  // sans suite ajoutent une charge de suivi (×1) ; un sujet qui en BLOQUE d'autres
  // consomme de l'attention collective (+1 chacun, +2 s'il y a un blocage critique).
  const ageMonths = ageDays != null && ageDays >= 0 ? ageDays / 30 : 0
  const score = ageMonths + reportIds.size + slippages * 2 + openActs.length + openAnoms.length * 2 + openReserves.length * 2 + pendingCr.length + impact.blocksCount + (impact.criticalImpact ? 2 : 0)
  const energy: SubjectEnergy = score >= 12 ? 'très élevée' : score >= 7 ? 'élevée' : score >= 3 ? 'moyenne' : 'basse'

  return {
    ageDays: ageDays != null && ageDays >= 0 ? ageDays : null,
    meetingsCount: reportIds.size,
    decisionsCount: decs.length,
    openActions: openActs.length,
    openReserves: openReserves.length,
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
    blocksCount: impact.blocksCount,
    criticalImpact: impact.criticalImpact,
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
  const [{ data: decisions }, { data: actions }, { data: anomI }, { data: anomA }, { data: reserves }, { data: crProps }] = await Promise.all([
    supabase.from('site_decisions').select('titre, date_decision, echeance, report_id, statut').eq('subject_id', subjectId),
    supabase.from('site_actions').select('title, created_at, due_date, report_id, status, assigned_to').eq('subject_id', subjectId),
    supabase.from('intervention_anomalies').select('description, category_other, resolved_at').eq('subject_id', subjectId),
    supabase.from('report_added_points').select('label, kind').eq('subject_id', subjectId).eq('kind', 'anomalie'),
    supabase.from('site_reserve').select('label, status').eq('subject_id', subjectId),
    supabase.from('site_report_proposals').select('short_label, type, status, created_entity_id, report_id, created_at').eq('subject_id', subjectId),
  ])
  const anoms = toAnomalies((anomI ?? []) as SubjRow[], (anomA ?? []) as SubjRow[])
  const impact = (await getSubjectImpactCounts([subjectId])).get(subjectId)
  return computeSubjectInsights(subject, decisions ?? [], actions ?? [], anoms, reserves ?? [], crProps ?? [], recurringMeetings, impact)
}

export interface SubjectWatch {
  id: string; name: string; state: SubjectState; ageDays: number | null
  energy: SubjectEnergy; cause: string | null; lastEvolution: string | null; openQuestion: string | null
  blocksCount: number; criticalImpact: boolean
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
  const [{ data: decisions }, { data: actions }, { data: anomI }, { data: anomA }, { data: reserves }, { data: crProps }] = await Promise.all([
    supabase.from('site_decisions').select('subject_id, titre, date_decision, echeance, report_id, statut').in('subject_id', ids),
    supabase.from('site_actions').select('subject_id, title, created_at, due_date, report_id, status, assigned_to').in('subject_id', ids),
    supabase.from('intervention_anomalies').select('subject_id, description, category_other, resolved_at').in('subject_id', ids),
    supabase.from('report_added_points').select('subject_id, label, kind').in('subject_id', ids).eq('kind', 'anomalie'),
    supabase.from('site_reserve').select('subject_id, label, status').in('subject_id', ids),
    supabase.from('site_report_proposals').select('subject_id, short_label, type, status, created_entity_id, report_id, created_at').in('subject_id', ids),
  ])
  const impactBy = await getSubjectImpactCounts(ids)
  const decBy = new Map<string, SubjRow[]>()
  for (const d of (decisions ?? []) as SubjRow[]) { const k = d.subject_id as string; const a = decBy.get(k); if (a) a.push(d); else decBy.set(k, [d]) }
  const actBy = new Map<string, SubjRow[]>()
  for (const a of (actions ?? []) as SubjRow[]) { const k = a.subject_id as string; const arr = actBy.get(k); if (arr) arr.push(a); else actBy.set(k, [a]) }
  const anomBy = new Map<string, SubjRow[]>()
  for (const a of [...((anomI ?? []) as SubjRow[]), ...((anomA ?? []) as SubjRow[])]) { const k = a.subject_id as string; const arr = anomBy.get(k); if (arr) arr.push(a); else anomBy.set(k, [a]) }
  const resBy = new Map<string, SubjRow[]>()
  for (const r of (reserves ?? []) as SubjRow[]) { const k = r.subject_id as string; const arr = resBy.get(k); if (arr) arr.push(r); else resBy.set(k, [r]) }
  const crBy = new Map<string, SubjRow[]>()
  for (const c of (crProps ?? []) as SubjRow[]) { const k = c.subject_id as string; const arr = crBy.get(k); if (arr) arr.push(c); else crBy.set(k, [c]) }

  return subjects
    .map((s) => {
      const raw = anomBy.get(s.id) ?? []
      const anoms = toAnomalies(raw.filter((r) => 'description' in r || 'category_other' in r), raw.filter((r) => 'kind' in r))
      return { s, ins: computeSubjectInsights(s, decBy.get(s.id) ?? [], actBy.get(s.id) ?? [], anoms, resBy.get(s.id) ?? [], crBy.get(s.id) ?? [], 3, impactBy.get(s.id)) }
    })
    // Appelle l'attention si : bloqué, en attente, échéance qui glisse, récurrent,
    // question ouverte, OU s'il bloque d'autres sujets (impact chantier).
    .filter(({ ins }) => ins.state === 'bloqué' || ins.state === 'en_attente' || ins.slippages > 0 || ins.recurring || ins.openQuestion != null || ins.blocksCount > 0)
    // Tri : impact critique d'abord, puis bloqué, puis énergie.
    .sort((a, b) =>
      (b.ins.criticalImpact ? 1 : 0) - (a.ins.criticalImpact ? 1 : 0) ||
      (a.ins.state === 'bloqué' ? 0 : 1) - (b.ins.state === 'bloqué' ? 0 : 1) ||
      ENERGY_RANK[b.ins.energy] - ENERGY_RANK[a.ins.energy])
    .slice(0, limit)
    .map(({ s, ins }) => ({ id: s.id, name: s.name, state: ins.state, ageDays: ins.ageDays, energy: ins.energy, cause: ins.cause?.text ?? null, lastEvolution: ins.lastEvolution, openQuestion: ins.openQuestion, blocksCount: ins.blocksCount, criticalImpact: ins.criticalImpact }))
}

/** Liste légère des points suivis ouverts d'un site (id + nom) — pour « Vérifier
 *  un point » du panier de visite. Aucun calcul d'insight, juste de quoi choisir. */
export async function listOpenSiteSubjectsLite(
  siteId: string,
  limit = 40,
): Promise<Array<{ id: string; name: string }>> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('subjects')
    .select('id, name')
    .eq('site_id', siteId)
    .neq('status', 'closed')
    .order('updated_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as Array<{ id: string; name: string }>).map((s) => ({ id: s.id, name: s.name }))
}

// RECHERCHE PAR SUJET (Build A) — Vincent : « taper DOE → la fiche du sujet, pas 54
// résultats ». Une VUE sur le graphe déjà relié : on résout un terme vers des SUJETS
// (par nom OU par contenu rattaché) et on rend la fiche riche de chacun. Déterministe.
export interface SubjectSearchResult {
  id: string; name: string; status: SubjectStatus
  matchedVia: 'nom' | 'contenu'
  hasObligation: boolean
  insights: SubjectInsights
}

export async function searchSiteSubjects(siteId: string, term: string, limit = 12): Promise<SubjectSearchResult[]> {
  const q = term.trim()
  if (!q) return []
  const supabase = createAdminClient()
  // Échappe les caractères qui cassent un filtre PostgREST `.or(... ilike ...)`.
  const like = `%${q.replace(/[(),%]/g, ' ').trim()}%`

  // 1. Résolution : match par NOM du sujet + par CONTENU rattaché (décision/action/réserve/obligation).
  const [{ data: byName }, { data: decM }, { data: actM }, { data: resM }, { data: oblM }] = await Promise.all([
    supabase.from('subjects').select('id').eq('site_id', siteId).ilike('name', like),
    supabase.from('site_decisions').select('subject_id').eq('site_id', siteId).not('subject_id', 'is', null).or(`titre.ilike.${like},sujet.ilike.${like}`),
    supabase.from('site_actions').select('subject_id').eq('site_id', siteId).not('subject_id', 'is', null).ilike('title', like),
    supabase.from('site_reserve').select('subject_id').eq('site_id', siteId).not('subject_id', 'is', null).ilike('label', like),
    supabase.from('site_obligation').select('subject_id').eq('site_id', siteId).not('subject_id', 'is', null).ilike('label', like),
  ])
  const nameIds = new Set(((byName ?? []) as { id: string }[]).map((r) => r.id))
  const contentIds = new Set<string>()
  for (const arr of [decM, actM, resM, oblM]) for (const r of (arr ?? []) as { subject_id: string | null }[]) if (r.subject_id) contentIds.add(r.subject_id)
  const ids = [...new Set([...nameIds, ...contentIds])].slice(0, limit)
  if (ids.length === 0) return []

  // 2. Fiche riche par sujet — batché (même patron que listSiteSubjectsToWatch).
  const { data: subs } = await supabase.from('subjects').select('*').in('id', ids)
  const subjects = (subs ?? []) as DbSubject[]
  const [{ data: decisions }, { data: actions }, { data: anomI }, { data: anomA }, { data: reserves }, { data: crProps }, { data: obls }] = await Promise.all([
    supabase.from('site_decisions').select('subject_id, titre, date_decision, echeance, report_id, statut').in('subject_id', ids),
    supabase.from('site_actions').select('subject_id, title, created_at, due_date, report_id, status, assigned_to').in('subject_id', ids),
    supabase.from('intervention_anomalies').select('subject_id, description, category_other, resolved_at').in('subject_id', ids),
    supabase.from('report_added_points').select('subject_id, label, kind').in('subject_id', ids).eq('kind', 'anomalie'),
    supabase.from('site_reserve').select('subject_id, label, status').in('subject_id', ids),
    supabase.from('site_report_proposals').select('subject_id, short_label, type, status, created_entity_id, report_id, created_at').in('subject_id', ids),
    supabase.from('site_obligation').select('subject_id').in('subject_id', ids),
  ])
  const impactBy = await getSubjectImpactCounts(ids)
  const group = (rows: unknown): Map<string, SubjRow[]> => {
    const m = new Map<string, SubjRow[]>()
    for (const r of (rows ?? []) as SubjRow[]) { const k = r.subject_id as string; const a = m.get(k); if (a) a.push(r); else m.set(k, [r]) }
    return m
  }
  const decBy = group(decisions), actBy = group(actions), resBy = group(reserves), crBy = group(crProps)
  const anomBy = group([...((anomI ?? []) as SubjRow[]), ...((anomA ?? []) as SubjRow[])])
  const oblSet = new Set(((obls ?? []) as { subject_id: string }[]).map((r) => r.subject_id))

  return subjects
    .map((s) => {
      const raw = anomBy.get(s.id) ?? []
      const anoms = toAnomalies(raw.filter((r) => 'description' in r || 'category_other' in r), raw.filter((r) => 'kind' in r))
      const insights = computeSubjectInsights(s, decBy.get(s.id) ?? [], actBy.get(s.id) ?? [], anoms, resBy.get(s.id) ?? [], crBy.get(s.id) ?? [], 3, impactBy.get(s.id))
      return { id: s.id, name: s.name, status: s.status, matchedVia: (nameIds.has(s.id) ? 'nom' : 'contenu') as 'nom' | 'contenu', hasObligation: oblSet.has(s.id), insights }
    })
    .sort((a, b) => ENERGY_RANK[b.insights.energy] - ENERGY_RANK[a.insights.energy])
}

// SANTÉ DE RATTACHEMENT (Vincent : le KPI INTERNE qui décide si la recherche sera bonne).
// % d'objets reliés à un sujet — pas Guillaume-facing, INDICATIF, jamais bloquant
// (doctrine « santé de la mémoire »). Un objet sans subject_id est invisible à la recherche.
export interface LinkageStat { total: number; linked: number; pct: number }
export interface SubjectLinkageHealth {
  actions: LinkageStat; decisions: LinkageStat; reserves: LinkageStat; obligations: LinkageStat; documents: LinkageStat
  overallPct: number
}
export async function getSubjectLinkageHealth(siteId: string): Promise<SubjectLinkageHealth> {
  const supabase = createAdminClient()
  const [{ data: acts }, { data: decs }, { data: res }, { data: obl }, siteDocs] = await Promise.all([
    supabase.from('site_actions').select('subject_id').eq('site_id', siteId).neq('status', 'cancelled'),
    supabase.from('site_decisions').select('subject_id').eq('site_id', siteId),
    supabase.from('site_reserve').select('subject_id').eq('site_id', siteId),
    supabase.from('site_obligation').select('subject_id').eq('site_id', siteId),
    listDocumentsForTarget('site', siteId).catch(() => []),
  ])
  const stat = (rows: { subject_id: string | null }[] | null): LinkageStat => {
    const all = rows ?? []
    const linked = all.filter((r) => r.subject_id != null).length
    return { total: all.length, linked, pct: all.length === 0 ? 0 : Math.round((linked / all.length) * 100) }
  }
  const actions = stat(acts as { subject_id: string | null }[])
  const decisions = stat(decs as { subject_id: string | null }[])
  const reserves = stat(res as { subject_id: string | null }[])
  const obligations = stat(obl as { subject_id: string | null }[])

  // Documents : pas de colonne subject_id (rattachement via document_links). On
  // compte les documents du site qui ont AUSSI un lien vers un sujet.
  const docIds = siteDocs.map((d) => d.id)
  let linkedDocs = 0
  if (docIds.length > 0) {
    const { data: subLinks } = await supabase.from('document_links').select('document_id').eq('target_type', 'subject').in('document_id', docIds)
    linkedDocs = new Set(((subLinks ?? []) as { document_id: string }[]).map((r) => r.document_id)).size
  }
  const documents: LinkageStat = { total: docIds.length, linked: linkedDocs, pct: docIds.length === 0 ? 0 : Math.round((linkedDocs / docIds.length) * 100) }

  const all = [actions, decisions, reserves, obligations, documents]
  const sumTotal = all.reduce((s, x) => s + x.total, 0)
  const sumLinked = all.reduce((s, x) => s + x.linked, 0)
  return { actions, decisions, reserves, obligations, documents, overallPct: sumTotal === 0 ? 0 : Math.round((sumLinked / sumTotal) * 100) }
}

/** HISTORIQUE CHRONOLOGIQUE d'un sujet — l'histoire complète, tous objets fusionnés et
 *  datés, situés à leur réunion (Vincent : « CR12 décision · CR14 promesse · … »). */
export async function getSubjectTimeline(subjectId: string): Promise<SubjectEvent[]> {
  const supabase = createAdminClient()
  const [{ data: decisions }, { data: actions }, { data: reserves }, { data: crDecisions }, { data: anomI }, { data: anomA }, { data: obligations }, documents] = await Promise.all([
    supabase.from('site_decisions').select('id, titre, statut, date_decision, echeance, report_id').eq('subject_id', subjectId),
    supabase.from('site_actions').select('id, title, status, due_date, created_at, report_id').eq('subject_id', subjectId),
    supabase.from('site_reserve').select('id, label, status, issued_on').eq('subject_id', subjectId),
    supabase.from('site_report_proposals').select('id, short_label, created_at, report_id').eq('subject_id', subjectId),
    supabase.from('intervention_anomalies').select('id, description, category_other, resolved_at, created_at').eq('subject_id', subjectId),
    supabase.from('report_added_points').select('id, label, created_at, report_id').eq('subject_id', subjectId).eq('kind', 'anomalie'),
    supabase.from('site_obligation').select('id, label, status, created_at, origin_excerpt, origin_ref, origin_date').eq('subject_id', subjectId),
    listDocumentsForTarget('subject', subjectId).catch(() => []),
  ])

  // Libellés FR des statuts d'obligation (cohérent avec la fiche obligations).
  const obligationStatusFr: Record<string, string> = {
    a_produire: 'à produire', en_cours: 'en cours', satisfaite: 'satisfaite', non_applicable: 'non applicable',
  }

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
  for (const o of obligations ?? []) {
    // Provenance documentaire (pont AO, mig 154) = le PREMIER événement de l'histoire :
    // « Exigé au CCTP p.148 : "Le DOE devra…" ». Daté à la réception de l'AO.
    if (o.origin_excerpt || o.origin_ref) {
      const originIso = (o.origin_date as string | null) ?? (o.created_at as string)
      events.push({ date: originIso.slice(0, 10), kind: 'origin',
        label: `Exigé${o.origin_ref ? ` — ${o.origin_ref}` : ''}`,
        meta: o.origin_excerpt ? `« ${(o.origin_excerpt as string).slice(0, 240)} »` : 'origine contractuelle', reportLabel: null })
    }
    events.push({ date: (o.created_at as string).slice(0, 10), kind: 'obligation', label: o.label as string,
      meta: `obligation (${obligationStatusFr[o.status as string] ?? (o.status as string)})`, reportLabel: null })
  }
  for (const doc of documents) {
    const at = (doc as { created_at?: string }).created_at
    events.push({ date: at ? at.slice(0, 10) : '', kind: 'document', label: (doc as { filename?: string }).filename ?? 'Document', meta: 'document', reportLabel: null })
  }

  // ── Dossier vivant : infos RETENUES + captures de VISITE rattachées à ce point.
  // C'est ce qui transforme un point suivi en HISTOIRE complète (Vincent 2026-06-28). ──
  const KNOWLEDGE_FR: Record<string, string> = {
    promise: 'promesse', risk: 'risque', attention: "point d'attention",
    missing_document: 'document manquant', context: 'contexte', other: 'à retenir',
  }
  const [{ data: knowledge }, { data: captures }] = await Promise.all([
    supabase.from('captured_knowledge').select('id, title, kind, created_at').eq('subject_id', subjectId),
    supabase.from('visit_capture').select('id, kind, body, created_at').eq('subject_id', subjectId).neq('status', 'discarded'),
  ])
  for (const k of (knowledge ?? []) as Array<{ title: string; kind: string; created_at: string }>) {
    events.push({ date: k.created_at.slice(0, 10), kind: 'knowledge', label: k.title,
      meta: `à retenir · ${KNOWLEDGE_FR[k.kind] ?? k.kind}`, reportLabel: null })
  }
  for (const c of (captures ?? []) as Array<{ kind: string; body: string | null; created_at: string }>) {
    const body = c.body?.trim() || null
    const label =
      c.kind === 'verification' ? `Vérification${body ? ` : ${body}` : ''}`
      : c.kind === 'vocal' ? (body ? `« ${body} »` : 'Mémo vocal')
      : c.kind === 'note' ? (body ?? 'Note')
      : c.kind === 'photo' ? 'Photo'
      : c.kind === 'position' ? 'Position' : 'Capture'
    events.push({ date: c.created_at.slice(0, 10), kind: 'capture', label,
      meta: c.kind === 'verification' ? 'vérification de visite' : `capture de visite · ${c.kind}`, reportLabel: null })
  }

  // Ordre CHRONOLOGIQUE (du plus ancien au plus récent) = l'histoire qui se déroule.
  return events.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date))
}
