import 'server-only'

// ── LOT 2B — Read-model consolidé « Intervenants » (site-scope) ─────────────────
//
// Mandat Vincent 2026-09-14 (audit Lot 1 : ARES/CAPSE NC/Lylo/MIES/UXELLO/Clim
// Exp'Air apparaissent en lignes dupliquées, la plupart des compteurs d'activité
// sont à 0). Ce fichier agrège par ENTREPRISE CANONIQUE (résolution alias, mig
// 407 + `resolveCanonicalCompanyId`) plutôt que par ligne `companies` brute :
// « Clim Exp'Air » et « Clim'Expair » (doublon de nom) deviennent une seule
// entrée, sans qu'aucune ligne `companies` ni aucune FK existante ne soit
// modifiée (`site_intervenants.company_id`, `site_actions.assigned_company_id`…
// continuent de référencer l'id d'origine ; seule cette lecture résout le
// canonique au moment de l'agrégation).
//
// LECTURE SEULE. Contrainte explicite du GO Lot 2 (Vincent) : aucune fusion
// physique de `companies`, aucun changement d'UI tant que ce read-model n'a pas
// été audité sur les 3 témoins RUS DUMBEA MALL (Clim Exp'Air à réunifier,
// Pacific Froid Clim dont l'Action doit enfin compter, Maz de Clim Exp'Air qui
// ne doit jamais être absorbé — ce dernier n'est même pas une ligne `companies`,
// donc hors de portée de ce fichier par construction).
//
// Dimensions couvertes :
//   1. Actions responsables   — site_actions.assigned_company_id (open/planned seulement,
//      même ensemble que site-intervenants-view.ts et company-fiche.ts : une Action
//      terminée/annulée n'est plus une charge de travail en cours)
//   2. Contacts               — annuaire COMPLET de company_contacts pour chaque entreprise
//      déjà pertinente sur ce site (casting/actions/points), pas seulement les contacts
//      portant une Action ; actionsCount reste précis via assigned_contact_id
//   3. Points pilotés         — tracked_point_responsible_companies (mig 406)
//   4. Présence dans les PV   — site_intervenants (casting), dédupliquée par canonique
// Dimension EXPLICITEMENT DIFFÉRÉE (gap documenté, pas un oubli) :
//   5. Points où citée — `computeCitedCompanies` (tracked-point-detail.ts) est calculé
//      PAR Point à partir de textes/preuves déjà chargés pour CE Point, jamais batché.
//      Le construire pour un site entier rechargerait `loadTrackedPointReadModel` et
//      dupliquerait une bonne partie de la machinerie de fiche Point pour une simple
//      lecture d'agrégation — complexité non demandée par les 3 témoins (CLAUDE.md §6).
//      Signalé dans `SiteIntervenantsConsolidated.gaps`, jamais tu.

import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { isActionOverdue } from '@/lib/knowledge/overdue-action'
import { resolveCanonicalCompanyId, type Company } from '@/lib/db/companies'

export interface ConsolidatedActionRow {
  id: string
  title: string
  dueDate: string | null
  overdue: boolean
  href: string
}

export interface ConsolidatedContactRow {
  id: string
  name: string
  function: string | null
  actionsCount: number
  href: string
}

export interface ConsolidatedPointRow {
  id: string
  label: string
  designatedAt: string
  href: string
}

export interface ConsolidatedCastingRow {
  id: string
  role: string
  active: boolean
  effectiveFrom: string | null
  effectiveTo: string | null
  /** id `companies` d'origine de CETTE ligne avant résolution canonique — trace d'audit Lot 2A. */
  sourceCompanyId: string
}

export interface ConsolidatedIntervenant {
  /** id `companies` CANONIQUE (jamais un alias — résolu par `resolveCanonicalCompanyId`). */
  companyId: string
  companyName: string
  /** ids alias résolus vers ce canonique (hors lui-même) — trace d'audit Lot 2A, vide hors fusion. */
  mergedCompanyIds: string[]
  actions: ConsolidatedActionRow[]
  overdueActionsCount: number
  contacts: ConsolidatedContactRow[]
  pointsPiloted: ConsolidatedPointRow[]
  casting: ConsolidatedCastingRow[]
  lastActivityAt: string | null
}

export interface SiteIntervenantsConsolidated {
  siteId: string
  intervenants: ConsolidatedIntervenant[]
  /** Dimensions demandées par Vincent mais non construites en V1 — jamais silencieux. */
  gaps: string[]
}

const POINTS_OU_CITEE_GAP =
  'Points où citée : non implémenté (computeCitedCompanies est calculé par Point, jamais batché sur un site entier — cf. commentaire de tête de fichier).'

export interface ConsolidatedInputs {
  today: string
  companiesById: Map<string, Pick<Company, 'id' | 'name' | 'status' | 'aliasOfCompanyId'>>
  casting: Array<{ id: string; companyId: string; role: string; effectiveFrom: string | null; effectiveTo: string | null }>
  actions: Array<{
    id: string
    title: string
    dueDate: string | null
    dueDateStatus: 'explicit' | 'estimated' | null
    status: string
    createdAt: string
    assignedCompanyId: string | null
    assignedContactId: string | null
  }>
  /** Contact → entreprise connue (`company_contacts.company_id`, peut être null : contact sans entreprise). */
  contactById: Map<string, { id: string; name: string; function: string | null; companyId: string | null }>
  pointsResponsible: Array<{ id: string; companyId: string; designatedAt: string; pointId: string; pointLabel: string }>
  siteId: string
}

/** Composition PURE — aucun accès réseau. */
export function buildSiteIntervenantsConsolidated(input: ConsolidatedInputs): SiteIntervenantsConsolidated {
  const canon = (id: string) => resolveCanonicalCompanyId(input.companiesById, id)

  const byCompany = new Map<string, ConsolidatedIntervenant>()
  const get = (id: string): ConsolidatedIntervenant => {
    const existing = byCompany.get(id)
    if (existing) return existing
    const created: ConsolidatedIntervenant = {
      companyId: id,
      companyName: input.companiesById.get(id)?.name ?? '—',
      mergedCompanyIds: [],
      actions: [],
      overdueActionsCount: 0,
      contacts: [],
      pointsPiloted: [],
      casting: [],
      lastActivityAt: null,
    }
    byCompany.set(id, created)
    return created
  }
  const bumpActivity = (entry: ConsolidatedIntervenant, at: string | null) => {
    if (at && (!entry.lastActivityAt || at > entry.lastActivityAt)) entry.lastActivityAt = at
  }

  // ── 4. Présence dans les PV (casting) ──────────────────────────────────────
  for (const c of input.casting) {
    const canonicalId = canon(c.companyId)
    const entry = get(canonicalId)
    if (c.companyId !== canonicalId && !entry.mergedCompanyIds.includes(c.companyId)) entry.mergedCompanyIds.push(c.companyId)
    entry.casting.push({
      id: c.id, role: c.role, active: c.effectiveTo === null,
      effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo, sourceCompanyId: c.companyId,
    })
    bumpActivity(entry, c.effectiveFrom)
  }

  // ── 1 & 2. Actions responsables (entreprise directe OU via contact) ───────
  // « Actions ouvertes » : seuls open/planned comptent (même ensemble que
  // site-intervenants-view.ts et company-fiche.ts) — une Action terminée/annulée
  // n'est plus une charge de travail en cours.
  const contactActionCounts = new Map<string, number>()
  for (const a of input.actions) {
    if (a.status !== 'open' && a.status !== 'planned') continue
    const directCompanyId = a.assignedCompanyId ? canon(a.assignedCompanyId) : null
    const contact = a.assignedContactId ? input.contactById.get(a.assignedContactId) : null
    const contactCompanyId = contact?.companyId ? canon(contact.companyId) : null
    // Une Action assignée à la fois à une entreprise ET à un contact d'une AUTRE entreprise
    // ne peut pas exister dans le modèle actuel (assigned_contact_id n'est pas contraint à
    // appartenir à assigned_company_id) — si les deux sont renseignés on ne compte l'Action
    // que sous l'entreprise directe (source de vérité structurelle la plus forte), jamais
    // sous les deux (éviterait un double comptage silencieux dans les totaux).
    const companyId = directCompanyId ?? contactCompanyId
    if (!companyId) continue
    const entry = get(companyId)
    const overdue = isActionOverdue(a.status, a.dueDate, a.dueDateStatus, input.today)
    entry.actions.push({ id: a.id, title: a.title, dueDate: a.dueDate, overdue, href: `/sites/${input.siteId}/action/${a.id}` })
    if (overdue) entry.overdueActionsCount++
    bumpActivity(entry, a.dueDate ?? a.createdAt)
    if (contact && !directCompanyId && contactCompanyId) {
      contactActionCounts.set(contact.id, (contactActionCounts.get(contact.id) ?? 0) + 1)
    }
  }
  // Contacts — annuaire COMPLET des personnes rattachées à l'entreprise (bloc
  // « Contacts » du Lot 3), pas seulement celles qui portent une Action. Le
  // compteur d'actions reste précis pour celles qui en portent (contactActionCounts).
  const contactsByCanonicalCompany = new Map<string, ConsolidatedContactRow[]>()
  for (const contact of input.contactById.values()) {
    if (!contact.companyId) continue
    const canonicalId = canon(contact.companyId)
    const list = contactsByCanonicalCompany.get(canonicalId) ?? []
    list.push({
      id: contact.id, name: contact.name, function: contact.function,
      actionsCount: contactActionCounts.get(contact.id) ?? 0,
      href: `/intervenants/personne/${contact.id}`,
    })
    contactsByCanonicalCompany.set(canonicalId, list)
  }
  for (const [companyId, contacts] of contactsByCanonicalCompany) {
    get(companyId).contacts = contacts
  }

  // ── 3. Points pilotés ───────────────────────────────────────────────────
  for (const p of input.pointsResponsible) {
    const entry = get(canon(p.companyId))
    entry.pointsPiloted.push({ id: p.id, label: p.pointLabel, designatedAt: p.designatedAt, href: `/sites/${input.siteId}/point/${p.pointId}` })
    bumpActivity(entry, p.designatedAt)
  }

  const intervenants = [...byCompany.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, 'fr'))
  return { siteId: input.siteId, intervenants, gaps: [POINTS_OU_CITEE_GAP] }
}

/** Charge et compose — site-scopé, aucune fusion physique. */
export async function getSiteIntervenantsConsolidated(siteId: string): Promise<SiteIntervenantsConsolidated | null> {
  const db = createAdminClient()
  const { data: siteRow } = await db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle()
  const site = siteRow as { id: string; organization_id: string } | null
  if (!site) return null

  const [castRes, actRes, pointRespRes] = await Promise.all([
    db.from('site_intervenants').select('id, company_id, role, effective_from, effective_to').eq('site_id', siteId).not('company_id', 'is', null),
    db.from('site_actions').select('id, title, due_date, due_date_status, status, created_at, assigned_company_id, assigned_contact_id').eq('site_id', siteId).in('status', ['open', 'planned']),
    db.from('tracked_point_responsible_companies').select('id, company_id, designated_at, tracked_point_id').eq('site_id', siteId).is('revoked_at', null),
  ])
  const casting = (castRes.data ?? []) as Array<{ id: string; company_id: string; role: string; effective_from: string | null; effective_to: string | null }>
  const actions = (actRes.data ?? []) as Array<{
    id: string; title: string; due_date: string | null; due_date_status: 'explicit' | 'estimated' | null
    status: string; created_at: string; assigned_company_id: string | null; assigned_contact_id: string | null
  }>
  const pointsResponsibleRaw = (pointRespRes.data ?? []) as Array<{ id: string; company_id: string; designated_at: string; tracked_point_id: string }>

  const relevantActions = actions.filter((a) => a.assigned_company_id || a.assigned_contact_id)
  // Contacts référencés DIRECTEMENT par une Action — sert d'abord à résoudre
  // l'entreprise du contact (canon), avant même de connaître `companyIds`.
  const directContactIds = [...new Set(relevantActions.map((a) => a.assigned_contact_id).filter((v): v is string => !!v))]
  const { data: directContactRows } = directContactIds.length
    ? await db.from('company_contacts').select('id, company_id').in('id', directContactIds)
    : { data: [] as Array<{ id: string; company_id: string | null }> }
  const directContactCompanyIds = ((directContactRows ?? []) as Array<{ company_id: string | null }>)
    .map((c) => c.company_id).filter((v): v is string => !!v)

  const pointIds = [...new Set(pointsResponsibleRaw.map((p) => p.tracked_point_id))]
  const { data: pointRows } = pointIds.length
    ? await db.from('tracked_point').select('id, label').in('id', pointIds)
    : { data: [] as Array<{ id: string; label: string }> }
  const pointLabelById = new Map(((pointRows ?? []) as Array<{ id: string; label: string }>).map((p) => [p.id, p.label]))
  const pointsResponsible = pointsResponsibleRaw.map((p) => ({
    id: p.id, companyId: p.company_id, designatedAt: p.designated_at,
    pointId: p.tracked_point_id, pointLabel: pointLabelById.get(p.tracked_point_id) ?? '(Point)',
  }))

  const companyIds = [...new Set([
    ...casting.map((c) => c.company_id),
    ...relevantActions.map((a) => a.assigned_company_id).filter((v): v is string => !!v),
    ...directContactCompanyIds,
    ...pointsResponsible.map((p) => p.companyId),
  ])]

  // Annuaire COMPLET des contacts (bloc « Contacts », Lot 3) — toutes les personnes
  // rattachées à une entreprise déjà pertinente sur ce site, pas seulement celles
  // qui portent une Action (cf. commentaire de tête de fichier, gap fermé).
  const { data: allContactRows } = companyIds.length
    ? await db.from('company_contacts').select('id, full_name, function, company_id').in('company_id', companyIds).is('deleted_at', null)
    : { data: [] as Array<{ id: string; full_name: string; function: string | null; company_id: string | null }> }
  const contactById = new Map(
    ((allContactRows ?? []) as Array<{ id: string; full_name: string; function: string | null; company_id: string | null }>)
      .map((c) => [c.id, { id: c.id, name: c.full_name, function: c.function, companyId: c.company_id }]),
  )
  // Toute entreprise ALIAS peut pointer vers une entreprise absente de `companyIds` (jamais
  // citée directement sur ce site) : un second aller-retour résout ces cibles pour que
  // `resolveCanonicalCompanyId` retombe toujours sur un nom connu, jamais sur l'id brut.
  const { data: companyRows } = companyIds.length
    ? await db.from('companies').select('id, name, status, alias_of_company_id').in('id', companyIds)
    : { data: [] as Array<{ id: string; name: string; status: string; alias_of_company_id: string | null }> }
  const missingTargets = [...new Set(
    ((companyRows ?? []) as Array<{ alias_of_company_id: string | null }>)
      .map((c) => c.alias_of_company_id).filter((v): v is string => !!v && !companyIds.includes(v)),
  )]
  const { data: extraCompanyRows } = missingTargets.length
    ? await db.from('companies').select('id, name, status, alias_of_company_id').in('id', missingTargets)
    : { data: [] as Array<{ id: string; name: string; status: string; alias_of_company_id: string | null }> }

  const companiesById = new Map(
    [...(companyRows ?? []), ...(extraCompanyRows ?? [])].map((c) => {
      const row = c as { id: string; name: string; status: string; alias_of_company_id: string | null }
      return [row.id, { id: row.id, name: row.name, status: (row.status === 'alias' ? 'alias' : 'active') as 'active' | 'alias', aliasOfCompanyId: row.alias_of_company_id }]
    }),
  )

  return buildSiteIntervenantsConsolidated({
    today: todayLocalIso(),
    companiesById,
    siteId,
    casting: casting.map((c) => ({ id: c.id, companyId: c.company_id, role: c.role, effectiveFrom: c.effective_from, effectiveTo: c.effective_to })),
    actions: relevantActions.map((a) => ({
      id: a.id, title: a.title, dueDate: a.due_date, dueDateStatus: a.due_date_status, status: a.status,
      createdAt: a.created_at, assignedCompanyId: a.assigned_company_id, assignedContactId: a.assigned_contact_id,
    })),
    contactById,
    pointsResponsible,
  })
}

/** Une seule entrée de la consolidation (fiche entreprise, Lot 3) — `companyId`
 *  est déjà résolu au canonique par construction : tous les liens de fiche sont
 *  émis à partir de `ConsolidatedIntervenant.companyId`, jamais d'un id alias. */
export async function getSiteCompanyFiche(siteId: string, companyId: string): Promise<ConsolidatedIntervenant | null> {
  const result = await getSiteIntervenantsConsolidated(siteId)
  return result?.intervenants.find((i) => i.companyId === companyId) ?? null
}
