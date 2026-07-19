import 'server-only'

// ── LES INTERVENANTS DU CHANTIER — read model de l'onglet + de la fiche ──────
// « Qui travaille sur ce chantier ? » — la question durable, distincte de
// l'Aperçu (« où en est le chantier ? »). Cadrage + maquette validés
// 2026-07-18 : liste compacte groupée par ENTREPRISE, zone « À identifier »
// séparée, FICHE NARRATIVE par personne.
//
// La fiche est l'objet TRANSVERSE du produit : le même IntervenantPerson est
// calculé ici, qu'on l'ouvre depuis l'onglet (liste) ou depuis n'importe quelle
// autre porte (Explorer, recherche, objets métier) via getSiteIntervenantFiche.
// Un seul read model, une seule vérité — jamais deux calculs qui divergent.
//
// Aucune nouvelle table : casting (migs 137/138) + propositions (mig 212).
// Chaque chiffre affiché est un FAIT daté et traçable. Jamais de score, jamais
// d'inférence.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { listSiteIntervenants, type SiteIntervenant } from '@/lib/db/site-intervenants'
import { splitPersonCompany } from '@/lib/knowledge/person-name'
import { assignedActionsByContact, type AssignedAction, type RawAssignedActionRow } from '@/lib/knowledge/assigned-actions'
import { todayLocalIso } from '@/lib/time/local-date'
import { buildIntervenantsDashboard, type IntervenantsDashboard } from '@/lib/knowledge/intervenants-dashboard-model'

export interface IntervenantCitedVisit {
  reportId: string
  date: string | null
}

export interface IntervenantElsewhere {
  siteId: string
  siteName: string
  role: string
}

export interface IntervenantPerson {
  intervenantId: string
  contactId: string | null
  /** Vrai si la ligne du casting pointe une PERSONNE (contact), faux si elle ne
   *  connaît que l'entreprise. */
  isPerson: boolean
  name: string
  fonction: string | null
  role: string
  companyId: string
  companyName: string
  phone: string | null
  mobile: string | null
  email: string | null
  /** Première apparition dans la mémoire du chantier (casting ou citation). */
  firstSeen: string | null
  /** Dernière activité datée (visite citée la plus récente, sinon entrée au casting). */
  lastActivity: string | null
  /** Les visites où il est cité (mentions confirmées + visite d'origine du casting). */
  citedVisits: IntervenantCitedVisit[]
  /** Nombre de mentions confirmées (transcriptions/captures). */
  mentionCount: number
  /** Ce que la personne doit faire sur CE chantier — actions ouvertes assignées
   *  STRUCTURELLEMENT (assigned_contact_id), jamais par texte/rôle (P2 Slice 3A). */
  assignedActions: AssignedAction[]
  /** Décisions PORTÉES sur ce chantier (decisionnaire_contact_id, mig 138). */
  decisionsCount: number
  /** La liste (titre + id) — pour ouvrir chaque décision depuis la fiche. */
  decisions: Array<{ id: string; titre: string }>
  /** Obligations OUVERTES sous sa responsabilité (responsible_contact_id, mig 146). */
  openObligationsCount: number
  /** Où on le connaît ailleurs (contact d'abord, sinon entreprise) — org-scopé. */
  elsewhere: IntervenantElsewhere[]
}

export interface IntervenantGroup {
  companyId: string
  companyName: string
  roles: string[]
  people: IntervenantPerson[]
}

export interface ToIdentifySuggestion {
  contactId: string
  name: string
  companyName: string
}

export interface ToIdentifyItem {
  proposalId: string
  title: string
  mentionCount: number
  /** Dates ISO des visites où le nom a été cité. */
  visitDates: string[]
  /** Rapprochement PRUDENT avec le registre de l'org : égalité stricte de nom
   *  normalisé uniquement — « correspond peut-être », jamais une fusion auto. */
  suggestion: ToIdentifySuggestion | null
}

export interface SiteIntervenantsView {
  siteId: string
  confirmedCount: number
  toIdentifyCount: number
  companies: string[]
  groups: IntervenantGroup[]
  toIdentify: ToIdentifyItem[]
}

const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

type Db = SupabaseClient

type StakeholderProp = {
  id: string; title: string; status: string; report_id: string | null
  source_capture_ids: string[] | null; promoted_object_id: string | null
}

/** Le cœur partagé : enrichit des lignes de casting en IntervenantPerson (faits
 *  datés, mentions confirmées, présence ailleurs). Appelé pour TOUT le casting
 *  (onglet) ou pour une seule ligne (fiche) — même calcul.
 *
 *  Ne lit AUCUNE action : le suivi par personne exige une relation structurelle
 *  action→contact qui n'existe pas encore (site_actions.assigned_to = texte
 *  libre). Le rapprochement rôle↔texte précédent n'était pas un fait métier — il
 *  a été retiré (Slice 0 du P2). La lecture par personne arrivera avec la FK
 *  assigned_contact_id. */
async function buildIntervenantPeople(
  db: Db, orgId: string, siteId: string, intervenants: SiteIntervenant[],
): Promise<IntervenantPerson[]> {
  if (intervenants.length === 0) return []

  const confirmedRes = await db.from('site_knowledge_proposals')
    .select('id, title, status, report_id, source_capture_ids, promoted_object_id')
    .eq('site_id', siteId).eq('kind', 'stakeholder').eq('status', 'confirmed')
  const confirmed = (confirmedRes.data ?? []) as StakeholderProp[]

  // Dates des visites citées (mentions + visite d'origine du casting).
  const reportIds = [...new Set([
    ...confirmed.map((p) => p.report_id),
    ...intervenants.map((i) => i.sourceReportId),
  ].filter((x): x is string => !!x))]
  const reportDate = new Map<string, string | null>()
  if (reportIds.length > 0) {
    const { data: reports } = await db.from('site_reports').select('id, started_at').in('id', reportIds)
    for (const r of (reports ?? []) as Array<{ id: string; started_at: string | null }>) {
      reportDate.set(r.id, r.started_at)
    }
  }

  // Mentions confirmées → leur intervenant. promoted_object_id vise le LIEN du
  // casting (nouvelles promotions) ou l'entreprise (lignes promues avant que
  // l'id du lien soit tracé) — on accepte les deux.
  const intByObjectId = new Map<string, string>()
  for (const it of intervenants) {
    intByObjectId.set(it.id, it.id)
    if (!intByObjectId.has(it.companyId)) intByObjectId.set(it.companyId, it.id)
  }
  const mentionsByIntervenant = new Map<string, StakeholderProp[]>()
  for (const p of confirmed) {
    if (!p.promoted_object_id) continue
    const target = intByObjectId.get(p.promoted_object_id)
    if (!target) continue
    const list = mentionsByIntervenant.get(target) ?? []
    list.push(p)
    mentionsByIntervenant.set(target, list)
  }

  // Où les connaît-on AILLEURS ? Contact d'abord (la personne), sinon
  // l'entreprise. Une seule lecture pour tout le casting, org-scopée fail-closed.
  const contactIds = [...new Set(intervenants.map((i) => i.mainContactId).filter((x): x is string => !!x))]
  const companyIds = [...new Set(intervenants.map((i) => i.companyId))]
  const elsewhereByContact = new Map<string, IntervenantElsewhere[]>()
  const elsewhereByCompany = new Map<string, IntervenantElsewhere[]>()
  {
    const orFilters = [
      contactIds.length > 0 ? `main_contact_id.in.(${contactIds.join(',')})` : null,
      `company_id.in.(${companyIds.join(',')})`,
    ].filter(Boolean).join(',')
    const { data: rows } = await db
      .from('site_intervenants')
      .select('site_id, role, company_id, main_contact_id')
      .neq('site_id', siteId)
      .is('effective_to', null)
      .or(orFilters)
    const otherSiteIds = [...new Set(((rows ?? []) as Array<{ site_id: string }>).map((r) => r.site_id))]
    if (otherSiteIds.length > 0) {
      // Fail-closed : uniquement les chantiers de NOTRE organisation.
      const { data: siteRows } = await db
        .from('sites').select('id, name').in('id', otherSiteIds).eq('organization_id', orgId).is('deleted_at', null)
      const siteName = new Map((siteRows ?? []).map((s) => [s.id as string, s.name as string]))
      for (const r of (rows ?? []) as Array<{ site_id: string; role: string; company_id: string; main_contact_id: string | null }>) {
        const name = siteName.get(r.site_id)
        if (!name) continue
        const entry: IntervenantElsewhere = { siteId: r.site_id, siteName: name, role: r.role }
        if (r.main_contact_id) {
          const l = elsewhereByContact.get(r.main_contact_id) ?? []
          l.push(entry); elsewhereByContact.set(r.main_contact_id, l)
        }
        const l = elsewhereByCompany.get(r.company_id) ?? []
        l.push(entry); elsewhereByCompany.set(r.company_id, l)
      }
    }
  }

  // ── Actions ASSIGNÉES structurellement (P2 Slice 3A) ──────────────────────
  // « Qu'attend-on de cette personne ? » — UNIQUEMENT par assigned_contact_id
  // (mig 220), jamais assigned_to/rôle. Une seule requête batch pour tout le
  // casting (pas de N+1), scopée au chantier. Une action assignée à un contact
  // hors casting actif n'est rattachée à personne (pas de personne orpheline).
  const activeContactIds = [...new Set(intervenants.map((i) => i.mainContactId).filter((x): x is string => !!x))]
  let actionsByContact = new Map<string, AssignedAction[]>()
  // Décisions portées + obligations ouvertes + dernières dates structurées (mig 138/146).
  const decisionsByContact = new Map<string, Array<{ id: string; titre: string }>>()
  const openObligationsByContact = new Map<string, number>()
  const lastStructuredByContact = new Map<string, string>()
  const bumpLast = (c: string, dt: string | null | undefined) => {
    if (!dt) return
    const prev = lastStructuredByContact.get(c)
    if (!prev || dt > prev) lastStructuredByContact.set(c, dt)
  }
  if (activeContactIds.length > 0) {
    const { data: actionRows } = await db.from('site_actions')
      .select('id, title, assigned_contact_id, due_date, due_date_status, report_id, status, created_at')
      .eq('site_id', siteId)
      .in('assigned_contact_id', activeContactIds)
      .in('status', ['open', 'planned'])
    actionsByContact = assignedActionsByContact(siteId, (actionRows ?? []) as RawAssignedActionRow[], todayLocalIso())
    for (const r of (actionRows ?? []) as Array<{ assigned_contact_id: string | null; created_at: string }>) {
      if (r.assigned_contact_id) bumpLast(r.assigned_contact_id, r.created_at)
    }
    const { data: decRows } = await db.from('site_decisions')
      .select('id, titre, decisionnaire_contact_id, date_decision, created_at').eq('site_id', siteId).in('decisionnaire_contact_id', activeContactIds)
      .order('date_decision', { ascending: false })
    for (const d of (decRows ?? []) as Array<{ id: string; titre: string; decisionnaire_contact_id: string | null; date_decision: string | null; created_at: string }>) {
      if (!d.decisionnaire_contact_id) continue
      const list = decisionsByContact.get(d.decisionnaire_contact_id) ?? []
      list.push({ id: d.id, titre: d.titre })
      decisionsByContact.set(d.decisionnaire_contact_id, list)
      bumpLast(d.decisionnaire_contact_id, d.date_decision ?? d.created_at)
    }
    const { data: oblRows } = await db.from('site_obligation')
      .select('responsible_contact_id, satisfied_at').eq('site_id', siteId).in('responsible_contact_id', activeContactIds)
    for (const o of (oblRows ?? []) as Array<{ responsible_contact_id: string | null; satisfied_at: string | null }>) {
      if (o.responsible_contact_id && !o.satisfied_at) openObligationsByContact.set(o.responsible_contact_id, (openObligationsByContact.get(o.responsible_contact_id) ?? 0) + 1)
    }
  }

  return intervenants.map((it) => {
    const mentions = mentionsByIntervenant.get(it.id) ?? []
    const visits = new Map<string, string | null>()
    for (const m of mentions) if (m.report_id) visits.set(m.report_id, reportDate.get(m.report_id) ?? null)
    if (it.sourceReportId) visits.set(it.sourceReportId, reportDate.get(it.sourceReportId) ?? null)
    const citedVisits = [...visits.entries()]
      .map(([reportId, date]) => ({ reportId, date }))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    const mentionCount = mentions.reduce((n, m) => n + Math.max(1, (m.source_capture_ids ?? []).length), 0)
    // « Dernière activité » = la plus récente trace STRUCTURÉE (casting, visite citée,
    // action, décision) — jamais une présence supposée.
    const lastStructured = it.mainContactId ? lastStructuredByContact.get(it.mainContactId) : null
    const dates = [it.effectiveFrom, ...citedVisits.map((v) => v.date), lastStructured].filter((x): x is string => !!x)
    const elsewhere = (it.mainContactId ? elsewhereByContact.get(it.mainContactId) : null)
      ?? elsewhereByCompany.get(it.companyId) ?? []
    return {
      intervenantId: it.id,
      contactId: it.mainContactId,
      isPerson: !!it.contactName,
      name: it.contactName ?? (it.companyShort || it.companyName),
      fonction: it.contactFunction,
      role: it.role,
      companyId: it.companyId,
      companyName: it.companyShort || it.companyName,
      phone: it.contactPhone,
      mobile: it.contactMobile,
      email: it.contactEmail,
      firstSeen: dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null,
      lastActivity: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      citedVisits,
      mentionCount,
      assignedActions: it.mainContactId ? actionsByContact.get(it.mainContactId) ?? [] : [],
      decisions: it.mainContactId ? decisionsByContact.get(it.mainContactId) ?? [] : [],
      decisionsCount: it.mainContactId ? (decisionsByContact.get(it.mainContactId)?.length ?? 0) : 0,
      openObligationsCount: it.mainContactId ? openObligationsByContact.get(it.mainContactId) ?? 0 : 0,
      // Dédoublonné par chantier — deux rôles sur le même chantier = une ligne.
      elsewhere: [...new Map(elsewhere.map((e) => [e.siteId, e])).values()],
    }
  })
}

/** Le chantier appartient-il à l'org de l'appelant ? Fail-closed : le
 *  service-role bypasse la RLS, la garde vit dans le code. Retourne l'orgId. */
async function siteOrgId(db: Db, siteId: string): Promise<string | null> {
  const orgId = await getOrgId()
  if (!orgId) return null
  const { data: site } = await db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle()
  if (!site || (site as { organization_id: string | null }).organization_id !== orgId) return null
  return orgId
}

/** La vue Intervenants d'un chantier (onglet). `null` si hors org (fail-closed). */
export async function getSiteIntervenantsView(siteId: string): Promise<SiteIntervenantsView | null> {
  const db = createAdminClient()
  const orgId = await siteOrgId(db, siteId)
  if (!orgId) return null

  const [intervenants, proposedRes] = await Promise.all([
    listSiteIntervenants(siteId).catch(() => [] as SiteIntervenant[]),
    db.from('site_knowledge_proposals')
      .select('id, title, status, report_id, source_capture_ids, promoted_object_id')
      .eq('site_id', siteId).eq('kind', 'stakeholder').eq('status', 'proposed')
      .order('created_at', { ascending: true }),
  ])
  const proposed = (proposedRes.data ?? []) as StakeholderProp[]

  const people = await buildIntervenantPeople(db, orgId, siteId, intervenants)

  // ── Groupé par entreprise (« qui est chez PAVE ? ») ──
  const groupByCompany = new Map<string, IntervenantGroup>()
  for (const p of people) {
    const g = groupByCompany.get(p.companyId) ?? {
      companyId: p.companyId, companyName: p.companyName, roles: [], people: [],
    }
    if (!g.roles.includes(p.role)) g.roles.push(p.role)
    g.people.push(p)
    groupByCompany.set(p.companyId, g)
  }
  const groups = [...groupByCompany.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, 'fr'))
  for (const g of groups) g.people.sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  // ── À identifier : les noms entendus, jamais mélangés au confirmé ──
  // Rapprochement avec le registre org : égalité STRICTE de nom normalisé
  // uniquement (fusionner deux personnes distinctes serait pire que ne rien
  // proposer). La proposition reste une proposition — l'humain tranche.
  const reportIds = [...new Set(proposed.map((p) => p.report_id).filter((x): x is string => !!x))]
  const reportDate = new Map<string, string | null>()
  if (reportIds.length > 0) {
    const { data: reports } = await db.from('site_reports').select('id, started_at').in('id', reportIds)
    for (const r of (reports ?? []) as Array<{ id: string; started_at: string | null }>) {
      reportDate.set(r.id, r.started_at)
    }
  }
  let contactsIndex: Array<{ id: string; name: string; norm: string; companyName: string }> = []
  if (proposed.length > 0) {
    const { data: orgCompanies } = await db
      .from('companies').select('id, name, short_name').eq('organization_id', orgId).is('deleted_at', null)
    const companyName = new Map((orgCompanies ?? []).map((c) => [
      c.id as string, ((c.short_name as string | null) || (c.name as string)) ?? '',
    ]))
    const orgCompanyIds = [...companyName.keys()]
    if (orgCompanyIds.length > 0) {
      const { data: contacts } = await db
        .from('company_contacts').select('id, full_name, company_id')
        .in('company_id', orgCompanyIds).is('deleted_at', null).limit(1000)
      contactsIndex = ((contacts ?? []) as Array<{ id: string; full_name: string; company_id: string }>).map((c) => ({
        id: c.id, name: c.full_name, norm: norm(c.full_name), companyName: companyName.get(c.company_id) ?? '',
      }))
    }
  }
  const toIdentify: ToIdentifyItem[] = proposed.map((p) => {
    const candidate = splitPersonCompany(p.title).person ?? p.title
    const match = contactsIndex.find((c) => c.norm === norm(candidate)) ?? null
    const dates = p.report_id ? [reportDate.get(p.report_id) ?? null].filter((x): x is string => !!x) : []
    return {
      proposalId: p.id,
      title: p.title,
      mentionCount: Math.max(1, (p.source_capture_ids ?? []).length),
      visitDates: dates,
      suggestion: match ? { contactId: match.id, name: match.name, companyName: match.companyName } : null,
    }
  })

  return {
    siteId,
    confirmedCount: people.length,
    toIdentifyCount: toIdentify.length,
    companies: groups.map((g) => g.companyName),
    groups,
    toIdentify,
  }
}

/** La PAGE Intervenants (pilotage) — PROJECTION de la vue existante vers un
 *  leaderboard + KPIs. Compose `getSiteIntervenantsView` : mêmes personnes, même
 *  vérité que la fiche ; on n'ajoute que le classement et les compteurs de vue. */
export async function getIntervenantsDashboard(siteId: string): Promise<IntervenantsDashboard | null> {
  const view = await getSiteIntervenantsView(siteId)
  if (!view) return null
  const people = view.groups.flatMap((g) => g.people)
  return buildIntervenantsDashboard(siteId, people, view.toIdentifyCount, todayLocalIso())
}

/** UNE fiche intervenant, chargée par identité — le point d'accès de « la fiche
 *  partout » (Explorer, recherche, objets métier). Résout par lien de casting
 *  (`intervenantId`) ou par contact (`contactId`, pour un décisionnaire/présent).
 *  `null` si hors org, ou si l'identité ne correspond à aucun intervenant ACTIF
 *  de ce chantier — on ne fabrique pas une fiche pour quelqu'un hors casting. */
export async function getSiteIntervenantFiche(
  siteId: string,
  key: { intervenantId?: string | null; contactId?: string | null },
): Promise<IntervenantPerson | null> {
  const db = createAdminClient()
  const orgId = await siteOrgId(db, siteId)
  if (!orgId) return null
  if (!key.intervenantId && !key.contactId) return null

  const intervenants = await listSiteIntervenants(siteId).catch(() => [] as SiteIntervenant[])
  const picked = intervenants.find((it) =>
    (key.intervenantId && it.id === key.intervenantId)
    || (key.contactId && it.mainContactId === key.contactId),
  )
  if (!picked) return null

  const people = await buildIntervenantPeople(db, orgId, siteId, [picked])
  return people[0] ?? null
}
