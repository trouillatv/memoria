import 'server-only'

// ── Identité et responsabilités d'un canonical_subject acteur ─────────────────
// Deux fonctions :
//   getActorIdentity()          — résout le lien contact_id/company_id → identité réelle
//   getActorResponsibilities()  — actions, réserves, échéances, décisions, rôles, sujets liés

import { createAdminClient } from '@/lib/supabase/admin'

// ── Identity ──────────────────────────────────────────────────────────────────

export type ActorLinkSource = 'auto' | 'llm' | 'manual'

export interface CompanyActorIdentity {
  kind: 'company'
  companyId: string
  name: string
  shortName: string | null
  phone: string | null
  email: string | null
  linkSource: ActorLinkSource
  linkValidatedAt: string | null
}

export interface PersonActorIdentity {
  kind: 'person'
  contactId: string
  fullName: string
  function: string | null
  phone: string | null
  mobile: string | null
  email: string | null
  companyId: string | null
  companyName: string | null
  linkSource: ActorLinkSource
  linkValidatedAt: string | null
}

export type ActorLinkedIdentity = CompanyActorIdentity | PersonActorIdentity

export async function getActorIdentity(canonicalSubjectId: string): Promise<ActorLinkedIdentity | null> {
  const sb = createAdminClient()

  const { data: cs } = await sb
    .from('canonical_subject')
    .select('company_id, contact_id, actor_link_source, actor_link_validated_at')
    .eq('id', canonicalSubjectId)
    .maybeSingle()

  if (!cs) return null
  const src = (cs.actor_link_source as ActorLinkSource | null) ?? 'auto'
  const validatedAt = cs.actor_link_validated_at as string | null

  if (cs.company_id) {
    const { data: company } = await sb
      .from('companies')
      .select('id, name, short_name, phone, email')
      .eq('id', cs.company_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!company) return null
    return {
      kind: 'company',
      companyId: company.id as string,
      name: company.name as string,
      shortName: company.short_name as string | null,
      phone: company.phone as string | null,
      email: company.email as string | null,
      linkSource: src,
      linkValidatedAt: validatedAt,
    }
  }

  if (cs.contact_id) {
    const { data: contact } = await sb
      .from('company_contacts')
      .select('id, full_name, function, phone, mobile, email, company_id')
      .eq('id', cs.contact_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!contact) return null

    let companyName: string | null = null
    if (contact.company_id) {
      const { data: comp } = await sb
        .from('companies')
        .select('name')
        .eq('id', contact.company_id)
        .is('deleted_at', null)
        .maybeSingle()
      companyName = (comp?.name as string | null) ?? null
    }

    return {
      kind: 'person',
      contactId: contact.id as string,
      fullName: contact.full_name as string,
      function: contact.function as string | null,
      phone: contact.phone as string | null,
      mobile: contact.mobile as string | null,
      email: contact.email as string | null,
      companyId: contact.company_id as string | null,
      companyName,
      linkSource: src,
      linkValidatedAt: validatedAt,
    }
  }

  return null
}

// ── Responsibilities ──────────────────────────────────────────────────────────

export interface ActorRole {
  id: string
  role: string
  effectiveFrom: string
  effectiveTo: string | null
}

export interface ActorAction {
  id: string
  title: string
  body: string | null
  status: string
  dueDate: string | null
  subjectThreadId: string | null
  doneAt: string | null
}

export interface ActorReserve {
  id: string
  label: string
  location: string | null
  status: 'open' | 'lifted'
  issuedOn: string | null
  liftedAt: string | null
}

export interface ActorDeadline {
  id: string
  title: string
  status: string
  dueDate: string | null
}

export interface ActorDecision {
  id: string
  titre: string
  statut: string
  dateDecision: string
  echeance: string | null
}

export interface ActorLinkedSubject {
  canonicalSubjectId: string
  label: string
}

export interface ActorResponsibilities {
  companyId: string | null
  contactId: string | null
  roles: ActorRole[]
  openActions: ActorAction[]
  doneActions: ActorAction[]
  openReserves: ActorReserve[]
  liftedReserves: ActorReserve[]
  openDeadlines: ActorDeadline[]
  openDecisions: ActorDecision[]
  doneDecisions: ActorDecision[]
  linkedSubjects: ActorLinkedSubject[]
  lastActivityAt: string | null
}

const DONE_ACTION_STATUSES = new Set(['done', 'cancelled'])
const OPEN_DEADLINE_STATUSES = new Set(['to_plan', 'planned'])
const OPEN_DECISION_STATUTS = new Set(['proposee', 'actee', 'appliquee'])

/** Retourne null rapidement si aucun lien company_id/contact_id n'est établi.
 *  Sinon, récupère rôles, actions, réserves, échéances, décisions et sujets liés. */
export async function getActorResponsibilities(
  siteId: string,
  canonicalSubjectId: string,
): Promise<ActorResponsibilities | null> {
  const sb = createAdminClient()

  // 1. Vérifier le lien acteur
  const { data: cs } = await sb
    .from('canonical_subject')
    .select('company_id, contact_id')
    .eq('id', canonicalSubjectId)
    .maybeSingle()

  if (!cs) return null
  const companyId = cs.company_id as string | null
  const contactId = cs.contact_id as string | null
  if (!companyId && !contactId) return null

  // 2. Toutes les requêtes en parallèle
  const [roles, allActions, allReserves, allDeadlines, allDecisions] = await Promise.all([
    fetchRoles(sb, siteId, companyId, contactId),
    fetchActions(sb, siteId, companyId, contactId),
    companyId ? fetchReserves(sb, siteId, companyId) : Promise.resolve([] as ActorReserve[]),
    fetchDeadlines(sb, siteId, companyId, contactId),
    fetchDecisions(sb, siteId, companyId, contactId),
  ])

  // 3. Séparer ouvert / terminé
  const openActions  = allActions.filter(a => !DONE_ACTION_STATUSES.has(a.status))
  const doneActions  = allActions.filter(a => DONE_ACTION_STATUSES.has(a.status))
  const openReserves = allReserves.filter(r => r.status === 'open')
  const liftedReserves = allReserves.filter(r => r.status === 'lifted')
  const openDeadlines = allDeadlines.filter(d => OPEN_DEADLINE_STATUSES.has(d.status))
  const openDecisions = allDecisions.filter(d => OPEN_DECISION_STATUTS.has(d.statut))
  const doneDecisions = allDecisions.filter(d => !OPEN_DECISION_STATUTS.has(d.statut))

  // 4. Sujets liés via subject_thread_id des actions
  const threadIds = [...new Set(allActions.map(a => a.subjectThreadId).filter(Boolean))] as string[]
  const linkedSubjects = threadIds.length
    ? await resolveLinkedSubjects(sb, siteId, canonicalSubjectId, threadIds)
    : []

  // 5. Dernière activité significative
  const activityDates: string[] = [
    ...doneActions.map(a => a.doneAt).filter(Boolean) as string[],
    ...liftedReserves.map(r => r.liftedAt).filter(Boolean) as string[],
  ]
  const lastActivityAt = activityDates.length > 0 ? activityDates.sort().at(-1)! : null

  return {
    companyId,
    contactId,
    roles,
    openActions,
    doneActions,
    openReserves,
    liftedReserves,
    openDeadlines,
    openDecisions,
    doneDecisions,
    linkedSubjects,
    lastActivityAt,
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

type SB = ReturnType<typeof createAdminClient>

async function fetchRoles(sb: SB, siteId: string, companyId: string | null, contactId: string | null): Promise<ActorRole[]> {
  let q = sb
    .from('site_intervenants')
    .select('id, role, effective_from, effective_to')
    .eq('site_id', siteId)
    .order('effective_from', { ascending: false })

  if (companyId) {
    q = q.eq('company_id', companyId) as typeof q
  } else if (contactId) {
    q = q.eq('main_contact_id', contactId) as typeof q
  } else {
    return []
  }

  const { data } = await q.limit(50)
  return (data ?? []).map(r => ({
    id: r.id as string,
    role: r.role as string,
    effectiveFrom: r.effective_from as string,
    effectiveTo: r.effective_to as string | null,
  }))
}

async function fetchActions(sb: SB, siteId: string, companyId: string | null, contactId: string | null): Promise<ActorAction[]> {
  const results: ActorAction[] = []

  if (companyId) {
    const { data } = await sb
      .from('site_actions')
      .select('id, title, body, status, due_date, subject_thread_id, done_at')
      .eq('site_id', siteId)
      .eq('assigned_company_id', companyId)
      .order('status')
      .limit(200)
    for (const r of data ?? []) results.push(mapAction(r))
  }

  if (contactId) {
    const { data } = await sb
      .from('site_actions')
      .select('id, title, body, status, due_date, subject_thread_id, done_at')
      .eq('site_id', siteId)
      .eq('assigned_contact_id', contactId)
      .order('status')
      .limit(200)
    for (const r of data ?? []) {
      if (!results.some(a => a.id === r.id)) results.push(mapAction(r))
    }
  }

  return results
}

function mapAction(r: Record<string, unknown>): ActorAction {
  return {
    id: r.id as string,
    title: r.title as string,
    body: r.body as string | null,
    status: r.status as string,
    dueDate: r.due_date as string | null,
    subjectThreadId: r.subject_thread_id as string | null,
    doneAt: r.done_at as string | null,
  }
}

async function fetchReserves(sb: SB, siteId: string, companyId: string): Promise<ActorReserve[]> {
  const { data } = await sb
    .from('site_reserve')
    .select('id, label, location, status, issued_on, lifted_at')
    .eq('site_id', siteId)
    .eq('responsible_company_id', companyId)
    .order('status')
    .limit(200)
  return (data ?? []).map(r => ({
    id: r.id as string,
    label: r.label as string,
    location: r.location as string | null,
    status: r.status as 'open' | 'lifted',
    issuedOn: r.issued_on as string | null,
    liftedAt: r.lifted_at as string | null,
  }))
}

async function fetchDeadlines(sb: SB, siteId: string, companyId: string | null, contactId: string | null): Promise<ActorDeadline[]> {
  const results: ActorDeadline[] = []

  if (companyId) {
    const { data } = await sb
      .from('site_deadlines')
      .select('id, title, status, due_date')
      .eq('site_id', siteId)
      .eq('assigned_company_id', companyId)
      .is('deleted_at', null)
      .limit(100)
    for (const r of data ?? []) results.push(mapDeadline(r))
  }

  if (contactId) {
    const { data } = await sb
      .from('site_deadlines')
      .select('id, title, status, due_date')
      .eq('site_id', siteId)
      .eq('assigned_contact_id', contactId)
      .is('deleted_at', null)
      .limit(100)
    for (const r of data ?? []) {
      if (!results.some(d => d.id === r.id)) results.push(mapDeadline(r))
    }
  }

  return results
}

function mapDeadline(r: Record<string, unknown>): ActorDeadline {
  return {
    id: r.id as string,
    title: r.title as string,
    status: r.status as string,
    dueDate: r.due_date as string | null,
  }
}

async function fetchDecisions(sb: SB, siteId: string, companyId: string | null, contactId: string | null): Promise<ActorDecision[]> {
  const results: ActorDecision[] = []

  if (companyId) {
    const { data } = await sb
      .from('site_decisions')
      .select('id, titre, statut, date_decision, echeance')
      .eq('site_id', siteId)
      .eq('decisionnaire_company_id', companyId)
      .order('date_decision', { ascending: false })
      .limit(100)
    for (const r of data ?? []) results.push(mapDecision(r))
  }

  if (contactId) {
    const { data } = await sb
      .from('site_decisions')
      .select('id, titre, statut, date_decision, echeance')
      .eq('site_id', siteId)
      .eq('decisionnaire_contact_id', contactId)
      .order('date_decision', { ascending: false })
      .limit(100)
    for (const r of data ?? []) {
      if (!results.some(d => d.id === r.id)) results.push(mapDecision(r))
    }
  }

  return results
}

function mapDecision(r: Record<string, unknown>): ActorDecision {
  return {
    id: r.id as string,
    titre: r.titre as string,
    statut: r.statut as string,
    dateDecision: r.date_decision as string,
    echeance: r.echeance as string | null,
  }
}

async function resolveLinkedSubjects(
  sb: SB,
  siteId: string,
  excludeCsId: string,
  threadIds: string[],
): Promise<ActorLinkedSubject[]> {
  const BATCH = 200
  const csIds = new Set<string>()

  for (let i = 0; i < threadIds.length; i += BATCH) {
    const { data } = await sb
      .from('subject_thread_identity')
      .select('canonical_subject_id')
      .in('subject_thread_id', threadIds.slice(i, i + BATCH))
      .eq('site_id', siteId)
    for (const r of data ?? []) {
      if (r.canonical_subject_id && r.canonical_subject_id !== excludeCsId) {
        csIds.add(r.canonical_subject_id as string)
      }
    }
  }

  if (!csIds.size) return []

  const { data } = await sb
    .from('canonical_subject')
    .select('id, label')
    .in('id', [...csIds])
    .eq('status', 'active')
    .limit(50)

  return (data ?? []).map(r => ({
    canonicalSubjectId: r.id as string,
    label: r.label as string,
  }))
}
