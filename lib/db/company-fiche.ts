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
import { reportProvenanceType, desktopSourceHref, PROVENANCE_LINK_LABEL } from '@/lib/knowledge/action-provenance'

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
  /** Date de la mention (site_intervenants.effective_from) — jamais « depuis ». */
  effectiveFrom: string | null
  href: string // /sites/{siteId}
}

/** Le PV source d'une mention, quand il est connu (`source_report_id` résolu).
 *  Aucune migration : uniquement ce que la base sait déjà. Absent → aucun lien
 *  inventé (jamais de fallback vers une autre source). */
export interface CompanyRoleSource {
  linkLabel: string // « Voir la visite » / « Voir le compte rendu » / « Voir le document »
  href: string | null
}

/** Un rôle MENTIONNÉ dans les documents, daté — jamais « le » rôle actuel.
 *  Plusieurs mentions actives simultanées sont un fait normal (classification
 *  qui dérive d'un PV à l'autre), pas une succession prouvée. Voir audit
 *  ACTOR-ROLE-TRUTH 2026-09 : ne jamais arbitrer entre elles.
 *  `active=false` = mention CLÔTURÉE (site_intervenants.effective_to renseigné) —
 *  reste dans la chronologie, jamais retirée : une mention documentaire ne
 *  disparaît pas parce que le casting a changé depuis.
 *  Identité d'une mention = chantier + date + PREUVE (`sourceReportId`), jamais
 *  seulement rôle+date : deux PV distincts (même chantier ou non) ne sont jamais
 *  fusionnés silencieusement en une seule ligne. Voir audit P0.2 2026-09-09
 *  (18 collisions réelles trouvées avec la clé rôle+date seule). */
export interface CompanyRoleMention {
  role: string
  effectiveFrom: string | null
  siteId: string
  siteName: string
  active: boolean
  source: CompanyRoleSource | null
}

export interface CompanySubjectRow {
  subjectId: string
  subjectName: string
  siteId: string
  siteName: string
  openCount: number
  totalCount: number
  href: string // /sites/{siteId}/historique/sujets/{canonicalSubjectId}
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
  /** Rôles mentionnés dans les documents, datés — jamais un rôle « actuel » unique. */
  roleMentions: CompanyRoleMention[]
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
  // Sujets portés : sujets canoniques rattachés à des actions dont cette entreprise est responsable
  subjectsCarried: CompanySubjectRow[]
}

export interface CompanyFicheInputs {
  today: string
  company: { id: string; name: string; short_name: string | null; siret: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; deleted_at: string | null }
  /** `id` = site_intervenants.id — repli d'identité quand `sourceReportId` est NULL (voir dédup ci-dessous). */
  casting: Array<{ id: string; siteId: string; siteName: string; role: string; active: boolean; effectiveFrom: string | null; mainContactId: string | null; source: CompanyRoleSource | null; sourceReportId: string | null }>
  actions: Array<{ id: string; title: string; siteId: string; siteName: string; dueDate: string | null; hasReferent: boolean; assignedContactName: string | null }>
  contacts: Array<{ id: string; name: string; function: string | null }>
  /** Ids des contacts référents d'au moins une action ouverte de cette entreprise. */
  referentContactIds: string[]
  subjectsCarried: CompanySubjectRow[]
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

  const activeCasting = input.casting.filter((c) => c.active).map((c) => ({ siteId: c.siteId, siteName: c.siteName, role: c.role, active: true, effectiveFrom: c.effectiveFrom, href: `/sites/${c.siteId}` }))
  const historicalCasting = input.casting.filter((c) => !c.active).map((c) => ({ siteId: c.siteId, siteName: c.siteName, role: c.role, active: false, effectiveFrom: c.effectiveFrom, href: `/sites/${c.siteId}` }))
  // Chronologie DOCUMENTAIRE, toutes mentions confondues (actives + closes) :
  // une mention clôturée reste un fait qui a existé, elle ne disparaît pas.
  // Mentions datées, jamais arbitrées : deux rôles actifs simultanés (même une
  // même entreprise, même chantier) restent DEUX lignes distinctes — jamais
  // fusionnées en une liste sans date ni « rôle actuel » choisi entre elles.
  // Identité d'une mention = rôle + date + CHANTIER + PREUVE (`sourceReportId`).
  // Deux PV distincts ne sont jamais fusionnés, même même rôle + même date +
  // même chantier (audit P0.2). Sans preuve connue (`sourceReportId` NULL), on
  // ne fusionne JAMAIS deux lignes distinctes sous prétexte qu'elles se
  // ressemblent : la clé replie alors sur `site_intervenants.id` (une ligne =
  // une mention). L'undermerge est préférable à une fusion de preuve non
  // démontrée (audit P0.2 correctif, 2026-09-09) : seul un doublon exact
  // (même sourceReportId) est dédupliqué.
  const mentionByKey = new Map<string, CompanyRoleMention>()
  for (const c of input.casting) {
    const key = c.sourceReportId
      ? `${c.role}__${c.effectiveFrom ?? ''}__${c.siteId}__report:${c.sourceReportId}`
      : `row:${c.id}`
    const existing = mentionByKey.get(key)
    if (existing) {
      existing.active = existing.active || c.active
      if (!existing.source && c.source) existing.source = c.source
      continue
    }
    mentionByKey.set(key, { role: c.role, effectiveFrom: c.effectiveFrom, siteId: c.siteId, siteName: c.siteName, active: c.active, source: c.source })
  }
  const roleMentions = [...mentionByKey.values()].sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''))
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
    roleMentions,
    activeSitesCount,
    actions,
    openCount,
    overdueCount,
    noReferentCount,
    activeCasting,
    historicalCasting,
    contacts,
    subjectsCarried: input.subjectsCarried,
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

  const [castRes, actRes, contactRes, subjectActRes] = await Promise.all([
    db.from('site_intervenants').select('id, site_id, role, effective_to, effective_from, main_contact_id, source_report_id').eq('company_id', companyId),
    db.from('site_actions').select('id, title, site_id, due_date, assigned_contact_id').eq('assigned_company_id', companyId).eq('status', 'open'),
    db.from('company_contacts').select('id, full_name, function').eq('company_id', companyId).is('deleted_at', null),
    // Toutes les actions (tous statuts) avec canonical_subject_id pour agréger les sujets portés.
    db.from('site_actions').select('canonical_subject_id, status, site_id').eq('assigned_company_id', companyId).not('canonical_subject_id', 'is', null),
  ])
  const cast = (castRes.data ?? []) as Array<{ id: string; site_id: string; role: string; effective_to: string | null; effective_from: string | null; main_contact_id: string | null; source_report_id: string | null }>
  const act = (actRes.data ?? []) as Array<{ id: string; title: string; site_id: string; due_date: string | null; assigned_contact_id: string | null }>
  const contactRows = (contactRes.data ?? []) as Array<{ id: string; full_name: string; function: string | null }>
  const subjectAct = (subjectActRes.data ?? []) as Array<{ canonical_subject_id: string; status: string; site_id: string }>

  const siteIds = [...new Set([...cast.map((r) => r.site_id), ...act.map((r) => r.site_id), ...subjectAct.map((a) => a.site_id)])]
  const { data: siteRows } = siteIds.length
    ? await db.from('sites').select('id, name').in('id', siteIds).in('organization_id', orgIds).is('deleted_at', null)
    : { data: [] as Array<{ id: string; name: string }> }
  const siteNameById = new Map(((siteRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
  const siteName = (id: string) => siteNameById.get(id) ?? 'Chantier'

  // Source documentaire d'une mention (« Voir le PV »), quand `source_report_id`
  // est connu — aucune migration : on ne fait que résoudre ce que la base sait
  // déjà (même primitives que `resolveReserveSourceLinks`). Report introuvable
  // (supprimé) → aucun lien inventé, la mention reste sans source.
  const reportIds = [...new Set(cast.map((c) => c.source_report_id).filter((v): v is string => !!v))]
  const { data: reportRows } = reportIds.length
    ? await db.from('site_reports').select('id, origin').in('id', reportIds)
    : { data: [] as Array<{ id: string; origin: string | null }> }
  const reportOriginById = new Map(((reportRows ?? []) as Array<{ id: string; origin: string | null }>).map((r) => [r.id, r.origin]))
  const castingSource = (c: { site_id: string; source_report_id: string | null }): CompanyRoleSource | null => {
    if (!c.source_report_id || !reportOriginById.has(c.source_report_id)) return null
    const type = reportProvenanceType(reportOriginById.get(c.source_report_id) ?? null)
    return { linkLabel: PROVENANCE_LINK_LABEL[type], href: desktopSourceHref(type, { siteId: c.site_id, reportId: c.source_report_id }) }
  }

  // Agrégation des sujets portés (par sujet canonique via FK canonical_subject_id — aucun matching).
  const subjectBuckets = new Map<string, { openCount: number; totalCount: number; siteId: string }>()
  for (const a of subjectAct) {
    const b = subjectBuckets.get(a.canonical_subject_id) ?? { openCount: 0, totalCount: 0, siteId: a.site_id }
    b.totalCount++
    if (a.status === 'open' || a.status === 'planned') b.openCount++
    subjectBuckets.set(a.canonical_subject_id, b)
  }
  const subjectIds = [...subjectBuckets.keys()]
  const { data: subjectRows } = subjectIds.length
    ? await db.from('canonical_subject').select('id, label').in('id', subjectIds)
    : { data: [] as Array<{ id: string; label: string | null }> }
  const subjectNameById = new Map(((subjectRows ?? []) as Array<{ id: string; label: string | null }>).map((s) => [s.id, s.label]))
  const subjectsCarried: CompanySubjectRow[] = [...subjectBuckets.entries()]
    .map(([subjectId, { openCount, totalCount, siteId }]) => ({
      subjectId,
      subjectName: subjectNameById.get(subjectId) ?? '(sujet)',
      siteId,
      siteName: siteName(siteId),
      openCount,
      totalCount,
      href: `/sites/${siteId}/historique/sujets/${subjectId}`,
    }))
    .sort((a, b) => b.openCount - a.openCount || b.totalCount - a.totalCount)

  const addressLine = [company.address, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null
  const contactNameById = new Map(contactRows.map((c) => [c.id, c.full_name]))

  return buildCompanyFiche({
    today,
    company: { id: company.id, name: company.name, short_name: company.short_name, siret: company.siret, address: addressLine, phone: company.phone, email: company.email, website: company.website, deleted_at: company.deleted_at },
    casting: cast.map((c) => ({ id: c.id, siteId: c.site_id, siteName: siteName(c.site_id), role: c.role, active: c.effective_to === null, effectiveFrom: c.effective_from, mainContactId: c.main_contact_id, source: castingSource(c), sourceReportId: c.source_report_id })),
    actions: act.map((a) => ({
      id: a.id, title: a.title, siteId: a.site_id, siteName: siteName(a.site_id), dueDate: a.due_date,
      hasReferent: a.assigned_contact_id !== null,
      assignedContactName: a.assigned_contact_id ? (contactNameById.get(a.assigned_contact_id) ?? null) : null,
    })),
    contacts: contactRows.map((c) => ({ id: c.id, name: c.full_name, function: c.function })),
    referentContactIds: [...new Set(act.map((a) => a.assigned_contact_id).filter((v): v is string => !!v))],
    subjectsCarried,
  })
}
