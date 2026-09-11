import 'server-only'

// ── LISTE DES POINTS D'UN CHANTIER (Lot 1 « Points comme entrée centrale », mandat Vincent) ──
//
// Compose au-dessus de tracked-point-read-model.ts, JAMAIS un second moteur d'état : le
// derivedState et le tri viennent tels quels de `loadTrackedPointReadModel` et
// `sortPointsForSubjectDisplay` (gelés). Ce fichier n'ajoute que de l'HYDRATATION en lecture
// (libellé du sujet propriétaire, noms d'acteurs) et un filtrage pur — jamais un recalcul d'état.
//
// Acteurs (§6, réutilisé) : même jointure que `getTrackedPointDetail`
// (canonical_business_object_member → site_actions/site_deadlines/site_reserve →
// company_contacts/companies), mais exécutée UNE SEULE FOIS pour tout le site au lieu d'une fois
// par Point — un simple batching, pas un nouveau moteur de calcul.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadTrackedPointReadModel,
  sortPointsForSubjectDisplay,
  type PointReadModelEntry,
} from '@/lib/knowledge/tracked-point-read-model'
import type { PointComputedCurrentState } from '@/lib/knowledge/tracked-point-lifecycle-reducer'
import { loadMemoriaNeedsYouSummary, filterMemoriaNeedsYouQuestionsForPoint } from '@/lib/knowledge/tracked-point-needs-you-summary'

type AdminClient = ReturnType<typeof createAdminClient>

export interface PointListEntry {
  id: string
  siteId: string
  label: string
  derivedState: PointComputedCurrentState
  latestMeaningfulEventAt: string | null
  ownerCanonicalSubjectId: string | null
  subjectLabel: string | null
  actorNames: string[]
  // Badge/filtre « Besoin de toi » (mandat Vincent, lot UX Cockpit+Points) : nombre de
  // questions NeedsYou qui référencent STRUCTURELLEMENT ce Point (cf.
  // filterMemoriaNeedsYouQuestionsForPoint, zéro heuristique). needsYouQuestionId n'est
  // renseigné que lorsqu'UNE SEULE question est concernée (deep-link ?q=<id> honnête,
  // jamais un choix arbitraire parmi plusieurs — même convention que resolveMemoriaNeedsYouSubjectPointRef).
  needsYouCount: number
  needsYouQuestionId: string | null
}

export interface PointListFilterOptions {
  subjects: Array<{ id: string; label: string }>
  actors: string[]
}

export interface SiteTrackedPointList {
  points: PointListEntry[]
  filters: PointListFilterOptions
}

async function loadSubjectLabels(db: AdminClient, subjectIds: string[]): Promise<Map<string, string>> {
  const labelById = new Map<string, string>()
  if (subjectIds.length === 0) return labelById
  const { data } = await db.from('canonical_subject').select('id, label').in('id', subjectIds)
  for (const row of data ?? []) labelById.set(row.id as string, row.label as string)
  return labelById
}

// Réplique batchée, à l'échelle du site, de la jointure §6 de `getTrackedPointDetail` —
// aucune règle d'attribution nouvelle, seulement la même union responsable
// contact > entreprise > texte libre, exécutée une fois pour tous les CBO du site.
async function loadActorNamesByPoint(
  db: AdminClient,
  siteId: string,
  points: PointReadModelEntry[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  const allCboIds = [...new Set(points.flatMap((p) => p.cboIds))]
  if (allCboIds.length === 0) return result

  const { data: memberRows } = await db
    .from('canonical_business_object_member')
    .select('canonical_business_object_id, member_entity_id, member_entity_type')
    .in('canonical_business_object_id', allCboIds)

  const actionIds = new Set<string>()
  const reserveIds = new Set<string>()
  const deadlineIds = new Set<string>()
  const entityRefsByCbo = new Map<string, Array<{ type: string; id: string }>>()
  for (const r of memberRows ?? []) {
    const type = r.member_entity_type as string
    const id = r.member_entity_id as string
    const cboId = r.canonical_business_object_id as string
    if (type === 'site_action') actionIds.add(id)
    else if (type === 'site_reserve') reserveIds.add(id)
    else if (type === 'site_deadline') deadlineIds.add(id)
    const list = entityRefsByCbo.get(cboId) ?? []
    list.push({ type, id })
    entityRefsByCbo.set(cboId, list)
  }

  const contactIds = new Set<string>()
  const companyIds = new Set<string>()

  type ActionRow = { id: string; assigned_to: string | null; assigned_contact_id: string | null; assigned_company_id: string | null }
  let actionRows: ActionRow[] = []
  if (actionIds.size > 0) {
    const { data } = await db.from('site_actions')
      .select('id, assigned_to, assigned_contact_id, assigned_company_id')
      .in('id', [...actionIds]).eq('site_id', siteId)
    actionRows = (data ?? []) as ActionRow[]
    for (const a of actionRows) {
      if (a.assigned_contact_id) contactIds.add(a.assigned_contact_id)
      if (a.assigned_company_id) companyIds.add(a.assigned_company_id)
    }
  }

  type DeadlineRow = { id: string; assigned_contact_id: string | null; assigned_company_id: string | null }
  let deadlineRows: DeadlineRow[] = []
  if (deadlineIds.size > 0) {
    const { data } = await db.from('site_deadlines')
      .select('id, assigned_contact_id, assigned_company_id')
      .in('id', [...deadlineIds]).eq('site_id', siteId)
    deadlineRows = (data ?? []) as DeadlineRow[]
    for (const d of deadlineRows) {
      if (d.assigned_contact_id) contactIds.add(d.assigned_contact_id)
      if (d.assigned_company_id) companyIds.add(d.assigned_company_id)
    }
  }

  type ReserveRow = { id: string; responsible_company_id: string | null }
  let reserveRows: ReserveRow[] = []
  if (reserveIds.size > 0) {
    const { data } = await db.from('site_reserve')
      .select('id, responsible_company_id')
      .in('id', [...reserveIds]).eq('site_id', siteId)
    reserveRows = (data ?? []) as ReserveRow[]
    for (const r of reserveRows) {
      if (r.responsible_company_id) companyIds.add(r.responsible_company_id)
    }
  }

  const contactNameById = new Map<string, string>()
  if (contactIds.size > 0) {
    const { data } = await db.from('company_contacts').select('id, full_name').in('id', [...contactIds])
    for (const c of data ?? []) contactNameById.set(c.id as string, c.full_name as string)
  }
  const companyNameById = new Map<string, string>()
  if (companyIds.size > 0) {
    const { data } = await db.from('companies').select('id, name').in('id', [...companyIds])
    for (const c of data ?? []) companyNameById.set(c.id as string, c.name as string)
  }

  const actionById = new Map(actionRows.map((a) => [a.id, a]))
  const deadlineById = new Map(deadlineRows.map((d) => [d.id, d]))
  const reserveById = new Map(reserveRows.map((r) => [r.id, r]))

  function nameForEntity(type: string, id: string): string | null {
    if (type === 'site_action') {
      const a = actionById.get(id)
      if (!a) return null
      if (a.assigned_contact_id) return contactNameById.get(a.assigned_contact_id) ?? null
      if (a.assigned_company_id) return companyNameById.get(a.assigned_company_id) ?? null
      return a.assigned_to
    }
    if (type === 'site_deadline') {
      const d = deadlineById.get(id)
      if (!d) return null
      if (d.assigned_contact_id) return contactNameById.get(d.assigned_contact_id) ?? null
      if (d.assigned_company_id) return companyNameById.get(d.assigned_company_id) ?? null
      return null
    }
    if (type === 'site_reserve') {
      const r = reserveById.get(id)
      if (!r) return null
      if (r.responsible_company_id) return companyNameById.get(r.responsible_company_id) ?? null
      return null
    }
    return null
  }

  for (const point of points) {
    const names = new Set<string>()
    for (const cboId of point.cboIds) {
      for (const ref of entityRefsByCbo.get(cboId) ?? []) {
        const name = nameForEntity(ref.type, ref.id)
        if (name) names.add(name)
      }
    }
    if (names.size > 0) result.set(point.id, [...names])
  }

  return result
}

export async function loadSiteTrackedPointList(siteId: string): Promise<SiteTrackedPointList> {
  const { points } = await loadTrackedPointReadModel(siteId)
  const sorted = sortPointsForSubjectDisplay(points)

  const db = createAdminClient()
  const subjectIds = [...new Set(sorted.map((p) => p.ownerCanonicalSubjectId).filter((id): id is string => !!id))]

  const [subjectLabelById, actorNamesByPoint, needsYou] = await Promise.all([
    loadSubjectLabels(db, subjectIds),
    loadActorNamesByPoint(db, siteId, sorted),
    loadMemoriaNeedsYouSummary(siteId),
  ])

  const entries: PointListEntry[] = sorted.map((p) => {
    const needsYouMatches = filterMemoriaNeedsYouQuestionsForPoint(needsYou.questions, p.id)
    return {
      id: p.id,
      siteId: p.siteId,
      label: p.label,
      derivedState: p.derivedState,
      latestMeaningfulEventAt: p.latestMeaningfulEventAt,
      ownerCanonicalSubjectId: p.ownerCanonicalSubjectId,
      subjectLabel: p.ownerCanonicalSubjectId ? subjectLabelById.get(p.ownerCanonicalSubjectId) ?? null : null,
      actorNames: actorNamesByPoint.get(p.id) ?? [],
      needsYouCount: needsYouMatches.length,
      needsYouQuestionId: needsYouMatches.length === 1 ? needsYouMatches[0].id : null,
    }
  })

  const subjects = [...subjectLabelById.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const actors = [...new Set(entries.flatMap((e) => e.actorNames))].sort((a, b) => a.localeCompare(b))

  return { points: entries, filters: { subjects, actors } }
}
