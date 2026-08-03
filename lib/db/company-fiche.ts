import 'server-only'

// ── FICHE ENTREPRISE (Lot 2B.3B) ─────────────────────────────────────────────
// Read model d'UNE entreprise (companies), org-globale et LECTURE SEULE. Répond
// « où intervient-elle, qu'attend-on d'elle ? ». Matière rendue possible par 2B.1
// (site_actions.assigned_company_id). État d'attention = POLITIQUE COMMUNE, donc
// aligné avec le cockpit. Placeholder « À identifier » exclu (pas de fiche).
//
// Statut : PAS de raccourci global simpliste (Vincent 2026-07-27) — actif globalement
// si au moins une relation actuelle, PUIS statut par chantier (casting actif/clôturé).
// Le VOLUME seul ne dégrade jamais l'état : 5 actions ouvertes sans retard ni manque
// de référent = À jour.
//
// buildCompanyFiche est PURE ; getCompanyFiche charge les lignes filtrées par l'id
// du sujet (aucun scan de table), fail-closed hors org / placeholder.

import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { deriveActorAttentionState, type AttentionState } from '@/lib/knowledge/actor-attention'
import type { ActorStatus } from '@/lib/db/actors-cockpit'

export interface CompanyFicheAction {
  id: string
  title: string
  siteId: string
  siteName: string
  dueDate: string | null
  overdue: boolean
  hasReferent: boolean
  assignedContactName: string | null
  href: string // /sites/{siteId}/action/{id}
}

export interface CompanyCastingRow {
  siteId: string
  siteName: string
  role: string
  active: boolean
  href: string // /sites/{siteId}
}

export interface CompanyContactRow {
  id: string
  name: string
  function: string | null
  isReferent: boolean     // référent d'au moins une action ouverte de l'entreprise
  isMainCasting: boolean  // contact principal d'un casting actif
  href: string // /intervenants/personne/{id}
}

export interface CompanyFiche {
  id: string
  name: string
  /** Statut GLOBAL (actif si ≥ 1 relation actuelle) — le détail par chantier vit dans le casting. */
  status: ActorStatus
  isArchived: boolean
  siret: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  attention: AttentionState
  activeRoles: string[]
  activeSitesCount: number
  // Situation / travail en cours
  actions: CompanyFicheAction[]
  openCount: number
  overdueCount: number
  noReferentCount: number
  // Présence opérationnelle (statut PAR chantier)
  activeCasting: CompanyCastingRow[]
  historicalCasting: CompanyCastingRow[]
  // Contacts
  contacts: CompanyContactRow[]
}

export interface CompanyFicheInputs {
  today: string
  company: { id: string; name: string; short_name: string | null; siret: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; deleted_at: string | null }
  casting: Array<{ siteId: string; siteName: string; role: string; active: boolean; mainContactId: string | null }>
  actions: Array<{ id: string; title: string; siteId: string; siteName: string; dueDate: string | null; hasReferent: boolean; assignedContactName: string | null }>
  contacts: Array<{ id: string; name: string; function: string | null }>
  /** Ids des contacts référents d'au moins une action ouverte de cette entreprise. */
  referentContactIds: string[]
}

/** Composition PURE. Déterministe ; attention via la politique commune. */
export function buildCompanyFiche(input: CompanyFicheInputs): CompanyFiche {
  const { today, company } = input
  const actions: CompanyFicheAction[] = input.actions
    .map((a) => ({ ...a, overdue: !!a.dueDate && a.dueDate < today, href: `/sites/${a.siteId}/action/${a.id}` }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue)) // retards d'abord
  const openCount = actions.length
  const overdueCount = actions.filter((a) => a.overdue).length
  const noReferentCount = actions.filter((a) => !a.hasReferent).length

  const activeCasting = input.casting.filter((c) => c.active).map((c) => ({ siteId: c.siteId, siteName: c.siteName, role: c.role, active: true, href: `/sites/${c.siteId}` }))
  const historicalCasting = input.casting.filter((c) => !c.active).map((c) => ({ siteId: c.siteId, siteName: c.siteName, role: c.role, active: false, href: `/sites/${c.siteId}` }))
  const activeRoles = [...new Set(activeCasting.map((c) => c.role))]
  const activeSitesCount = new Set(activeCasting.map((c) => c.siteId)).size

  // Statut GLOBAL : actif dès qu'une relation actuelle existe. Jamais fondé sur le volume.
  const active = activeCasting.length > 0 || openCount > 0
  const status: ActorStatus = active ? 'active' : (input.contacts.length === 0 ? 'incomplete' : 'historical')

  const attention = deriveActorAttentionState({
    kind: 'company',
    overdueActions: overdueCount,
    actionsWithoutReferent: noReferentCount,
    leftCastingWithOpenActions: openCount > 0 && activeCasting.length === 0,
  })

  const referentSet = new Set(input.referentContactIds)
  const mainCastingSet = new Set(input.casting.filter((c) => c.active && c.mainContactId).map((c) => c.mainContactId as string))
  const contacts: CompanyContactRow[] = input.contacts.map((c) => ({
    id: c.id, name: c.name, function: c.function,
    isReferent: referentSet.has(c.id),
    isMainCasting: mainCastingSet.has(c.id),
    href: `/intervenants/personne/${c.id}`,
  }))

  return {
    id: company.id,
    name: company.short_name || company.name,
    status,
    isArchived: !!company.deleted_at,
    siret: company.siret,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
    attention,
    activeRoles,
    activeSitesCount,
    actions,
    openCount,
    overdueCount,
    noReferentCount,
    activeCasting,
    historicalCasting,
    contacts,
  }
}

/**
 * Charge la fiche d'une entreprise, org-scopée et FAIL-CLOSED (hors org ou placeholder
 * → null). Toutes les requêtes filtrées par l'id du sujet — aucun scan de table.
 */
export async function getCompanyFiche(companyId: string, orgIds: string[]): Promise<CompanyFiche | null> {
  if (orgIds.length === 0) return null
  const db = createAdminClient()
  const today = todayLocalIso()

  const { data: companyRow } = await db
    .from('companies')
    .select('id, name, short_name, is_placeholder, deleted_at, organization_id, siret, address, postal_code, city, phone, email, website')
    .eq('id', companyId)
    .maybeSingle()
  const company = companyRow as
    | { id: string; name: string; short_name: string | null; is_placeholder: boolean; deleted_at: string | null; organization_id: string; siret: string | null; address: string | null; postal_code: string | null; city: string | null; phone: string | null; email: string | null; website: string | null }
    | null
  // Fail-closed : hors org, ou placeholder « À identifier » (jamais de fiche).
  if (!company || company.is_placeholder || !orgIds.includes(company.organization_id)) return null

  const [castRes, actRes, contactRes] = await Promise.all([
    db.from('site_intervenants').select('site_id, role, effective_to, main_contact_id').eq('company_id', companyId),
    db.from('site_actions').select('id, title, site_id, due_date, assigned_contact_id').eq('assigned_company_id', companyId).eq('status', 'open'),
    db.from('company_contacts').select('id, full_name, function').eq('company_id', companyId).is('deleted_at', null),
  ])
  const cast = (castRes.data ?? []) as Array<{ site_id: string; role: string; effective_to: string | null; main_contact_id: string | null }>
  const act = (actRes.data ?? []) as Array<{ id: string; title: string; site_id: string; due_date: string | null; assigned_contact_id: string | null }>
  const contactRows = (contactRes.data ?? []) as Array<{ id: string; full_name: string; function: string | null }>

  const siteIds = [...new Set([...cast.map((r) => r.site_id), ...act.map((r) => r.site_id)])]
  const { data: siteRows } = siteIds.length
    ? await db.from('sites').select('id, name').in('id', siteIds).in('organization_id', orgIds).is('deleted_at', null)
    : { data: [] as Array<{ id: string; name: string }> }
  const siteNameById = new Map(((siteRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
  const siteName = (id: string) => siteNameById.get(id) ?? 'Chantier'

  const addressLine = [company.address, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null
  const contactNameById = new Map(contactRows.map((c) => [c.id, c.full_name]))

  return buildCompanyFiche({
    today,
    company: { id: company.id, name: company.name, short_name: company.short_name, siret: company.siret, address: addressLine, phone: company.phone, email: company.email, website: company.website, deleted_at: company.deleted_at },
    casting: cast.map((c) => ({ siteId: c.site_id, siteName: siteName(c.site_id), role: c.role, active: c.effective_to === null, mainContactId: c.main_contact_id })),
    actions: act.map((a) => ({
      id: a.id, title: a.title, siteId: a.site_id, siteName: siteName(a.site_id), dueDate: a.due_date,
      hasReferent: a.assigned_contact_id !== null,
      assignedContactName: a.assigned_contact_id ? (contactNameById.get(a.assigned_contact_id) ?? null) : null,
    })),
    contacts: contactRows.map((c) => ({ id: c.id, name: c.full_name, function: c.function })),
    referentContactIds: [...new Set(act.map((a) => a.assigned_contact_id).filter((v): v is string => !!v))],
  })
}
