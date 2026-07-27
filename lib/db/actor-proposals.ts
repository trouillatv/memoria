import 'server-only'

// ── FILE ORG-GLOBALE DES ACTEURS À CONFIRMER ─────────────────────────────────
// La page Acteurs devient l'endroit où l'organisation transforme les noms
// ENTENDUS sur le terrain (CR, visites, réunions) en identités FIABLES. On ne
// crée PAS un second système de propositions : on AGRÈGE le flux existant
// `site_knowledge_proposals` (kind='stakeholder', status='proposed') au niveau
// organisation. L'onglet chantier garde sa vue contextualisée ; les deux
// surfaces consomment la MÊME source de vérité (confirmer ici retire la
// mention là-bas).
//
// Doctrine : une mention textuelle n'est pas une identité ; une proposition
// n'est pas encore un acteur ; seul un acteur confirmé devient une donnée métier
// réutilisable. Aucune fusion automatique — le rapprochement reste une suggestion.

import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import { splitPersonCompany, looksLikePerson } from '@/lib/knowledge/person-name'

export interface ActorProposalSource {
  siteId: string
  siteName: string
  reportId: string | null
  reportDate: string | null
  /** origin renseigné = visite terrain ; null = réunion (mig 162). */
  reportKind: 'visit' | 'meeting' | null
  excerpt: string | null
}

export interface ActorProposalSuggestion {
  kind: 'contact' | 'company'
  id: string
  name: string
  companyName: string | null
}

export interface ActorProposal {
  id: string
  /** Mention brute lue dans le mémo (« Jean Dupont », « Jean (ETV) », « Ginger »). */
  title: string
  personName: string | null
  companyName: string | null
  /** Indice d'affichage (préselection Personne/Entreprise) — jamais une décision. */
  likelyPerson: boolean
  createdAt: string
  source: ActorProposalSource
  suggestion: ActorProposalSuggestion | null
}

export function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

export interface MentionReading {
  personName: string | null
  companyName: string | null
  likelyPerson: boolean
}

/** Lecture personne/entreprise d'une mention brute (pré-remplissage) — jamais une
 *  décision d'écriture : « Jean (ETV) » → personne + entreprise ; « Ginger » →
 *  entreprise probable ; « Jean Dupont » → personne probable. */
export function deriveMention(title: string): MentionReading {
  const split = splitPersonCompany(title)
  return {
    personName: split.person,
    companyName: split.company,
    likelyPerson: split.person != null || looksLikePerson(title),
  }
}

/** Suggestion de rapprochement par nom NORMALISÉ (jamais une fusion : l'humain
 *  tranche). Une mention-personne ne se rapproche que d'un contact, une
 *  mention-entreprise que d'une entreprise. null si aucun match sûr. */
export function pickSuggestion(
  m: MentionReading & { title: string },
  contacts: Array<{ id: string; name: string; companyName: string | null }>,
  companies: Array<{ id: string; name: string }>,
): ActorProposalSuggestion | null {
  if (m.likelyPerson) {
    const key = normalizeName(m.personName ?? m.title)
    const hit = contacts.find((c) => normalizeName(c.name) === key)
    return hit ? { kind: 'contact', id: hit.id, name: hit.name, companyName: hit.companyName } : null
  }
  const key = normalizeName(m.companyName ?? m.title)
  const hit = companies.find((c) => normalizeName(c.name) === key)
  return hit ? { kind: 'company', id: hit.id, name: hit.name, companyName: null } : null
}

/** Propositions stakeholder non traitées de l'organisation, enrichies de leur
 *  provenance (chantier, date/type de source, extrait) et d'une suggestion de
 *  rapprochement par nom normalisé. Fail-closed : sans org, liste vide. */
export async function getUnconfirmedActorProposals(orgIds: string[]): Promise<ActorProposal[]> {
  if (orgIds.length === 0) return []
  const db = createAdminClient()
  const { data: rows } = await db
    .from('site_knowledge_proposals')
    .select('id, title, site_id, report_id, source_capture_ids, created_at')
    .in('organization_id', orgIds)
    .eq('kind', 'stakeholder')
    .eq('status', 'proposed')
    .order('created_at', { ascending: false })
  const list = (rows ?? []) as Array<{ id: string; title: string; site_id: string; report_id: string | null; source_capture_ids: string[] | null; created_at: string }>
  if (list.length === 0) return []

  const siteIds = [...new Set(list.map((r) => r.site_id))]
  const reportIds = [...new Set(list.map((r) => r.report_id).filter((x): x is string => !!x))]
  const captureIds = [...new Set(list.flatMap((r) => r.source_capture_ids ?? []))]

  const [siteRes, reportRes, captureRes, contactRes, companyRes] = await Promise.all([
    db.from('sites').select('id, name').in('id', siteIds),
    reportIds.length ? db.from('site_reports').select('id, started_at, created_at, title, origin').in('id', reportIds) : Promise.resolve({ data: [] }),
    captureIds.length ? db.from('visit_capture').select('id, body').in('id', captureIds) : Promise.resolve({ data: [] }),
    db.from('company_contacts').select('id, full_name, company_id').in('organization_id', orgIds).is('deleted_at', null),
    db.from('companies').select('id, name, is_placeholder, deleted_at').in('organization_id', orgIds),
  ])

  const siteName = new Map(((siteRes.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
  const reportById = new Map(((reportRes.data ?? []) as Array<{ id: string; started_at: string | null; created_at: string; title: string | null; origin: string | null }>).map((r) => [r.id, r]))
  const captureBody = new Map<string, string>()
  for (const c of (captureRes.data ?? []) as Array<{ id: string; body: string | null }>) if (c.body) captureBody.set(c.id, c.body)

  const companies = ((companyRes.data ?? []) as Array<{ id: string; name: string; is_placeholder: boolean; deleted_at: string | null }>)
    .filter((c) => !c.is_placeholder && !c.deleted_at)
    .map((c) => ({ id: c.id, name: c.name }))
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]))
  const contacts = ((contactRes.data ?? []) as Array<{ id: string; full_name: string; company_id: string | null }>)
    .map((c) => ({ id: c.id, name: c.full_name, companyName: c.company_id ? companyNameById.get(c.company_id) ?? null : null }))

  return list.map((r) => {
    const m = deriveMention(r.title)
    let excerpt: string | null = null
    for (const cid of r.source_capture_ids ?? []) { const b = captureBody.get(cid); if (b) { excerpt = truncate(b, 160); break } }
    const rep = r.report_id ? reportById.get(r.report_id) ?? null : null
    const reportDate = rep ? rep.started_at ?? rep.created_at : null
    const reportKind: 'visit' | 'meeting' | null = rep ? (rep.origin ? 'visit' : 'meeting') : null

    return {
      id: r.id,
      title: r.title,
      personName: m.personName,
      companyName: m.companyName,
      likelyPerson: m.likelyPerson,
      createdAt: r.created_at,
      source: { siteId: r.site_id, siteName: siteName.get(r.site_id) ?? 'Chantier', reportId: r.report_id, reportDate, reportKind, excerpt },
      suggestion: pickSuggestion({ ...m, title: r.title }, contacts, companies),
    }
  })
}

export interface ActorTarget {
  kind: 'contact' | 'company'
  id: string
  name: string
  function: string | null
}

/** Recherche unifiée personnes + entreprises de l'org (pour « associer à un
 *  acteur existant »). Nom normalisé, actifs, hors placeholder. Jamais de fusion :
 *  l'humain choisit la cible. */
export async function searchOrgActorTargets(orgIds: string[], query: string, limit = 6): Promise<ActorTarget[]> {
  const q = query.trim()
  if (orgIds.length === 0 || q.length < 2) return []
  const db = createAdminClient()
  const [personsRes, companiesRes] = await Promise.all([
    db.from('company_contacts').select('id, full_name, function').in('organization_id', orgIds).is('deleted_at', null).ilike('full_name', `%${q}%`).order('full_name', { ascending: true }).limit(limit),
    db.from('companies').select('id, name').in('organization_id', orgIds).is('deleted_at', null).eq('is_placeholder', false).ilike('name', `%${q}%`).order('name', { ascending: true }).limit(limit),
  ])
  const persons: ActorTarget[] = ((personsRes.data ?? []) as Array<{ id: string; full_name: string; function: string | null }>).map((c) => ({ kind: 'contact', id: c.id, name: c.full_name, function: c.function }))
  const companies: ActorTarget[] = ((companiesRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => ({ kind: 'company', id: c.id, name: c.name, function: null }))
  return [...persons, ...companies]
}

export interface ProposalForConfirm {
  id: string
  orgId: string
  siteId: string
  reportId: string | null
  title: string
}

/** Charge une proposition stakeholder ENCORE proposée, garde org fail-closed. */
export async function getActorProposalForConfirm(proposalId: string, orgIds: string[]): Promise<ProposalForConfirm | null> {
  if (orgIds.length === 0) return null
  const db = createAdminClient()
  const { data } = await db
    .from('site_knowledge_proposals')
    .select('id, organization_id, site_id, report_id, title, kind, status')
    .eq('id', proposalId)
    .in('organization_id', orgIds)
    .maybeSingle()
  const row = data as { id: string; organization_id: string; site_id: string; report_id: string | null; title: string; kind: string; status: string } | null
  if (!row || row.kind !== 'stakeholder' || row.status !== 'proposed') return null
  return { id: row.id, orgId: row.organization_id, siteId: row.site_id, reportId: row.report_id, title: row.title }
}

/** company_id d'un contact de l'org (pour le casting éventuel). null si le contact
 *  n'a pas d'entreprise ; retourne `null` (objet) si le contact n'est pas dans l'org. */
export async function getContactCompanyInOrg(contactId: string, orgIds: string[]): Promise<{ companyId: string | null } | null> {
  if (orgIds.length === 0) return null
  const db = createAdminClient()
  const { data } = await db.from('company_contacts').select('company_id').eq('id', contactId).in('organization_id', orgIds).is('deleted_at', null).maybeSingle()
  if (!data) return null
  return { companyId: (data as { company_id: string | null }).company_id }
}

export async function companyInOrg(companyId: string, orgIds: string[]): Promise<boolean> {
  if (orgIds.length === 0) return false
  const db = createAdminClient()
  const { data } = await db.from('companies').select('id').eq('id', companyId).in('organization_id', orgIds).is('deleted_at', null).maybeSingle()
  return !!data
}

export async function siteInOrg(siteId: string, orgIds: string[]): Promise<boolean> {
  if (orgIds.length === 0) return false
  const db = createAdminClient()
  const { data } = await db.from('sites').select('id').eq('id', siteId).in('organization_id', orgIds).is('deleted_at', null).maybeSingle()
  return !!data
}

/** Marque la proposition CONFIRMÉE et la relie à l'acteur créé/associé, sans la
 *  détruire (provenance conservée). `promotedType` : 'company_contact' | 'company'
 *  (identité seule) ou 'site_intervenant' (casting demandé explicitement). Garde
 *  org + précondition status='proposed' (fail-closed, idempotent face aux courses). */
export async function confirmActorProposal(input: {
  proposalId: string
  orgIds: string[]
  promotedType: 'company_contact' | 'company' | 'site_intervenant'
  promotedId: string
  reviewedBy: string | null
}): Promise<{ ok: boolean; siteId: string | null }> {
  if (input.orgIds.length === 0) return { ok: false, siteId: null }
  const db = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('site_knowledge_proposals')
    .update({ status: 'confirmed', promoted_object_type: input.promotedType, promoted_object_id: input.promotedId, reviewed_at: now, reviewed_by: input.reviewedBy, updated_at: now })
    .eq('id', input.proposalId)
    .eq('kind', 'stakeholder')
    .eq('status', 'proposed')
    .in('organization_id', input.orgIds)
    .select('site_id')
  if (error) throw error
  const siteId = (data as Array<{ site_id: string }> | null)?.[0]?.site_id ?? null
  // Confirmer retire aussi la mention de l'onglet chantier « à identifier ».
  if (siteId) invalidateSiteProjection(siteId)
  return { ok: !!siteId, siteId }
}
