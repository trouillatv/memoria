// Page Passages de témoin — helpers DB + génération de brief.
//
// Vincent 2026-05-22 — Sprint Équipes C (killer feature).
//
// Doctrine V2 ABSOLUE :
//   ✅ Le brief documente LE SITE et la mémoire utile à transmettre :
//      à savoir, anomalies récentes, contacts client, docs rattachés,
//      équipes voisines qui connaissent ce site (back-up).
//   ✅ Snapshot JSONB au moment T → résistant aux changements ultérieurs.
//   ✅ Cycle de vie auditable : draft → shared → acknowledged → archived.
//
//   ❌ JAMAIS la personne qui s'en va comme sujet d'évaluation.
//   ❌ JAMAIS « Untel faisait bien / mal », « raisons du départ ».
//   ❌ JAMAIS de notation, score, ranking.
//
// Convention : ce fichier est l'allowlist pour les agrégats nécessaires à la
// construction du brief. Les fonctions ne retournent JAMAIS de jugement
// qualitatif, uniquement des faits descriptifs (compteurs, dates, listes).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { isSystemMissionName } from '@/lib/db/system-missions'
import { listTeamCompanions } from '@/lib/db/team-profile'
import type {
  DbHandoverBrief,
  HandoverKind,
  HandoverPayload,
  HandoverStatus,
} from '@/types/db'

// ----------------------------------------------------------------------------
// Helpers internes
// ----------------------------------------------------------------------------

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] as T) ?? null : v
}

/** Cap appliqué côté snapshot pour éviter les payloads gigantesques. */
const SITE_CAP = 12
const ANOMALY_PER_SITE = 5
const DOC_PER_SITE = 6
const NEIGHBOR_TEAMS_PER_SITE = 4
const NEXT_EVENTS_PER_SITE = 4

// ----------------------------------------------------------------------------
// Fonctions de compilation — calculent un payload prêt à insérer
// ----------------------------------------------------------------------------

interface SiteContextRow {
  site_id: string
  site_name: string
  contract_id: string | null
  contract_name: string | null
  client_name: string | null
  interventionsCount: number
  lastInterventionDate: string | null
}

/** Liste les sites couverts par une équipe (interventions documentées). */
async function listSitesCoveredByTeam(teamId: string): Promise<SiteContextRow[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('interventions')
    .select(`
      id, scheduled_for, status,
      mission:missions!inner(
        name,
        site:sites!inner(
          id, name,
          contract:contracts(id, name),
          client:clients(name)
        )
      )
    `)
    .eq('assigned_team_id', teamId)

  type Row = {
    id: string
    scheduled_for: string | null
    status: string
    mission: unknown
  }

  const bySite = new Map<string, SiteContextRow>()
  for (const r of (data ?? []) as Row[]) {
    const mission = pickOne(r.mission) as { name?: string; site?: unknown } | null
    if (!mission?.name) continue
    if (isSystemMissionName(mission.name)) continue
    const site = pickOne(mission.site) as {
      id?: string
      name?: string
      contract?: unknown
      client?: unknown
    } | null
    if (!site?.id || !site.name) continue
    if (!['planned', 'in_progress', 'completed', 'validated'].includes(r.status)) continue
    const contract = pickOne(site.contract) as { id?: string; name?: string } | null
    const client = pickOne(site.client) as { name?: string } | null

    const cur = bySite.get(site.id)
    if (!cur) {
      bySite.set(site.id, {
        site_id: site.id,
        site_name: site.name,
        contract_id: contract?.id ?? null,
        contract_name: contract?.name ?? null,
        client_name: client?.name ?? null,
        interventionsCount: 1,
        lastInterventionDate: r.scheduled_for,
      })
    } else {
      cur.interventionsCount += 1
      if (
        r.scheduled_for &&
        (!cur.lastInterventionDate || r.scheduled_for > cur.lastInterventionDate)
      ) {
        cur.lastInterventionDate = r.scheduled_for
      }
    }
  }
  return Array.from(bySite.values()).sort((a, b) => {
    if (b.interventionsCount !== a.interventionsCount) {
      return b.interventionsCount - a.interventionsCount
    }
    return (b.lastInterventionDate ?? '').localeCompare(a.lastInterventionDate ?? '')
  })
}

/** Liste les sites couverts via les équipes actives d'un user. */
async function listSitesCoveredViaUserTeams(userId: string): Promise<SiteContextRow[]> {
  const admin = createAdminClient()
  const { data: memberships } = await admin
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .is('left_at', null)
  const teamIds = ((memberships ?? []) as Array<{ team_id: string }>).map((m) => m.team_id)
  if (teamIds.length === 0) return []

  const all = await Promise.all(teamIds.map((tid) => listSitesCoveredByTeam(tid)))
  // Dédup par site_id en cumulant les compteurs
  const merged = new Map<string, SiteContextRow>()
  for (const arr of all) {
    for (const s of arr) {
      const cur = merged.get(s.site_id)
      if (!cur) {
        merged.set(s.site_id, { ...s })
      } else {
        cur.interventionsCount += s.interventionsCount
        if (
          s.lastInterventionDate &&
          (!cur.lastInterventionDate || s.lastInterventionDate > cur.lastInterventionDate)
        ) {
          cur.lastInterventionDate = s.lastInterventionDate
        }
      }
    }
  }
  return Array.from(merged.values()).sort((a, b) => {
    if (b.interventionsCount !== a.interventionsCount) {
      return b.interventionsCount - a.interventionsCount
    }
    return (b.lastInterventionDate ?? '').localeCompare(a.lastInterventionDate ?? '')
  })
}

/** Pour 1 site, compile la mémoire utile (à savoir, anomalies, docs, voisins). */
async function buildSiteContextEntry(
  base: SiteContextRow,
): Promise<HandoverPayload['sites'][number]> {
  const admin = createAdminClient()

  // À savoir (consignes persistantes)
  const today = new Date().toISOString().slice(0, 10)
  const { data: aSavoir } = await admin
    .from('site_notes')
    .select('id, body, active_until')
    .eq('site_id', base.site_id)
    .eq('kind', 'a_savoir')
    .is('deleted_at', null)
    .or(`active_until.is.null,active_until.gte.${today}`)
    .order('created_at', { ascending: false })
    .limit(8)

  // Anomalies récentes sur ce site — Sprint D : filtre par défaut sur
  // status='open' + cutoff 90 jours (philosophie-de-loubli). Les anomalies
  // résolues ou ignorées ne polluent plus les briefs ; les anomalies très
  // anciennes non plus. Le manager peut quand même les consulter via la
  // fiche site `/sites/[id]`.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: anomalies } = await admin
    .from('intervention_anomalies')
    .select(`
      id, category, description, created_at, status,
      intervention:interventions!inner(
        mission:missions!inner(site_id)
      )
    `)
    .eq('status', 'open')
    // Scoper la requête AU SITE côté DB (via les jointures !inner), sinon le
    // limit(40) GLOBAL peut écarter silencieusement les anomalies du site quand
    // l'entreprise en a beaucoup ailleurs → brief incomplet. (Audit board A1.)
    .eq('intervention.mission.site_id', base.site_id)
    .gte('created_at', ninetyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(40)

  type AnomalyRow = {
    id: string
    category: string
    description: string | null
    created_at: string
    status: string
    intervention:
      | { mission: { site_id: string } | { site_id: string }[] }
      | { mission: { site_id: string } | { site_id: string }[] }[]
      | null
  }
  const recentAnomalies: HandoverPayload['sites'][number]['recentAnomalies'] = []
  for (const a of (anomalies ?? []) as unknown as AnomalyRow[]) {
    if (recentAnomalies.length >= ANOMALY_PER_SITE) break
    const intervention = pickOne(a.intervention)
    if (!intervention) continue
    const mission = pickOne(intervention.mission)
    if (!mission || mission.site_id !== base.site_id) continue
    recentAnomalies.push({
      id: a.id,
      category: a.category,
      description: a.description ?? '',
      occurredAt: a.created_at,
    })
  }

  // Documents rattachés au site
  const { data: docLinks } = await admin
    .from('document_links')
    .select(`
      document_id,
      document:documents(id, filename, document_type, deleted_at, status)
    `)
    .eq('target_type', 'site')
    .eq('target_id', base.site_id)
    .limit(40)

  type DocLinkRow = {
    document_id: string
    document: {
      id: string
      filename: string
      document_type: string | null
      deleted_at: string | null
      status: string
    } | { id: string; filename: string; document_type: string | null; deleted_at: string | null; status: string }[] | null
  }
  const documents: HandoverPayload['sites'][number]['documents'] = []
  for (const dl of (docLinks ?? []) as DocLinkRow[]) {
    if (documents.length >= DOC_PER_SITE) break
    const d = pickOne(dl.document)
    if (!d || d.deleted_at || d.status !== 'active') continue
    // Doctrine [[litige-no-automatic-reading]] : on n'INCLUT PAS les litiges
    // dans les briefs auto. Si manager veut les inclure manuellement, il le
    // fera via manualNotes.
    if (d.document_type === 'litige') continue
    documents.push({
      id: d.id,
      title: d.filename,
      documentType: d.document_type,
    })
  }

  // Équipes voisines qui connaissent ce site (= équipes ayant des
  // interventions sur ce site, autres que l'équipe d'origine)
  const { data: neighbors } = await admin
    .from('interventions')
    .select(`
      assigned_team_id,
      mission:missions!inner(site_id),
      team:teams(id, name, color, deleted_at)
    `)
    .not('assigned_team_id', 'is', null)
    .limit(200)

  type NeighborRow = {
    assigned_team_id: string | null
    mission: { site_id: string } | { site_id: string }[] | null
    team: { id: string; name: string; color: string | null; deleted_at: string | null } | { id: string; name: string; color: string | null; deleted_at: string | null }[] | null
  }
  const neighborMap = new Map<string, { team_id: string; team_name: string; team_color: string | null }>()
  for (const n of (neighbors ?? []) as NeighborRow[]) {
    const mission = pickOne(n.mission)
    if (!mission || mission.site_id !== base.site_id) continue
    const team = pickOne(n.team)
    if (!team || team.deleted_at) continue
    if (neighborMap.has(team.id)) continue
    neighborMap.set(team.id, {
      team_id: team.id,
      team_name: team.name,
      team_color: team.color,
    })
    if (neighborMap.size >= NEIGHBOR_TEAMS_PER_SITE) break
  }

  // Réserves OUVERTES du site (Passation) — les plus anciennes d'abord. État du
  // site à reprendre, jamais évaluation d'une personne. Cap 5 + « +N autres ».
  const { data: reserveRows } = await admin
    .from('site_reserve')
    .select('id, label, location, issued_on, status')
    .eq('site_id', base.site_id)
    .eq('status', 'open')
    .order('issued_on', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(50)
  const allReserves = (reserveRows ?? []) as Array<{ id: string; label: string; location: string | null; issued_on: string | null }>
  const openReserves = allReserves.slice(0, 5).map((r) => ({
    id: r.id, label: r.label, location: r.location ?? null, issuedOn: r.issued_on ?? null,
  }))
  const openReservesMore = Math.max(0, allReserves.length - openReserves.length)

  // Actions à suivre (open/planned) — EN RETARD d'abord, puis ouvertes. Cap 6.
  const { data: actionRows } = await admin
    .from('site_actions')
    .select('id, title, assigned_to, due_date, status, created_at')
    .eq('site_id', base.site_id)
    .in('status', ['open', 'planned'])
    .limit(100)
  const actionsAll = ((actionRows ?? []) as Array<{
    id: string; title: string; assigned_to: string | null; due_date: string | null; created_at: string
  }>)
    .map((a) => ({ ...a, late: a.due_date != null && a.due_date < today }))
    .sort((a, b) => {
      if (a.late !== b.late) return a.late ? -1 : 1 // en retard d'abord
      // puis par échéance la plus proche, sinon plus ancienne d'abord
      const ad = a.due_date ?? '9999-12-31', bd = b.due_date ?? '9999-12-31'
      return ad.localeCompare(bd) || a.created_at.localeCompare(b.created_at)
    })
  const openActions = actionsAll.slice(0, 6).map((a) => ({
    id: a.id, title: a.title, assignedTo: a.assigned_to, dueDate: a.due_date, late: a.late,
  }))
  const openActionsMore = Math.max(0, actionsAll.length - openActions.length)

  // Décisions de réunion VALIDÉES récentes (proposals acceptées). Cap 3.
  const { data: decisionRows } = await admin
    .from('site_report_proposals')
    .select('id, short_label, corps_etat, created_at, status, site_id')
    .eq('site_id', base.site_id)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false })
    .limit(3)
  const recentDecisions = ((decisionRows ?? []) as Array<{
    id: string; short_label: string; corps_etat: string | null; created_at: string
  }>).map((d) => ({ id: d.id, label: d.short_label, corpsEtat: d.corps_etat ?? null, at: d.created_at }))

  // Prochaines échéances : ce qui est déjà engagé APRÈS la reprise. Une passation
  // ne transmet pas seulement le passé — celui qui reprend doit savoir ce qui
  // l'attend. Interventions encore à venir uniquement. Cap 4.
  const { data: upcomingRows } = await admin
    .from('interventions')
    .select(`
      id, scheduled_for, status,
      team:teams(name),
      mission:missions!inner(name, site_id)
    `)
    .eq('mission.site_id', base.site_id)
    .in('status', ['planned', 'in_progress'])
    .gte('scheduled_for', today)
    .order('scheduled_for', { ascending: true })
    .limit(NEXT_EVENTS_PER_SITE)

  type UpcomingRow = {
    id: string
    scheduled_for: string | null
    team: { name: string } | { name: string }[] | null
    mission: { name: string; site_id: string } | { name: string; site_id: string }[] | null
  }
  const nextEvents: NonNullable<HandoverPayload['sites'][number]['nextEvents']> = []
  for (const r of (upcomingRows ?? []) as UpcomingRow[]) {
    const mission = pickOne(r.mission)
    if (!mission || mission.site_id !== base.site_id || !r.scheduled_for) continue
    if (isSystemMissionName(mission.name)) continue
    nextEvents.push({
      id: r.id,
      label: mission.name,
      on: r.scheduled_for,
      teamName: pickOne(r.team)?.name ?? null,
    })
  }

  return {
    site_id: base.site_id,
    site_name: base.site_name,
    contract_id: base.contract_id,
    contract_name: base.contract_name,
    client_name: base.client_name,
    openReserves,
    openReservesMore,
    openActions,
    openActionsMore,
    recentDecisions,
    nextEvents,
    aSavoir: ((aSavoir ?? []) as Array<{
      id: string
      body: string
      active_until: string | null
    }>).map((a) => ({
      id: a.id,
      title: a.body.slice(0, 80),
      description: a.body.length > 80 ? a.body : null,
    })),
    recentAnomalies,
    documents,
    neighborTeams: Array.from(neighborMap.values()),
    interventionsCount: base.interventionsCount,
    lastInterventionDate: base.lastInterventionDate,
  }
}

// ----------------------------------------------------------------------------
// Public API — Build briefs
// ----------------------------------------------------------------------------

export interface BuildMemberChangeInput {
  subjectUserId: string
  sourceTeamId?: string | null
  targetTeamId?: string | null
}

/**
 * Compile le brief pour un changement d'équipe (membre qui bascule).
 *
 * Stratégie : on récupère les sites connus via les équipes actives du user.
 * Si une équipe source est fournie, on PRIORISE les sites de cette équipe
 * (le focus est ce qui doit être transmis).
 */
export async function buildMemberChangePayload(
  input: BuildMemberChangeInput,
): Promise<{ payload: HandoverPayload; title: string }> {
  const admin = createAdminClient()

  // Identité du sujet (NOM uniquement, jamais évaluatif)
  const { data: u } = await admin
    .from('users')
    .select('full_name, email')
    .eq('id', input.subjectUserId)
    .maybeSingle()
  const subjectLabel =
    (u?.full_name ?? '').trim() || (u?.email ?? '').split('@')[0] || 'la personne'

  // Identité des équipes source / cible
  const teamIds = [input.sourceTeamId, input.targetTeamId].filter(
    (id): id is string => !!id,
  )
  const { data: teams } =
    teamIds.length > 0
      ? await admin.from('teams').select('id, name').in('id', teamIds)
      : { data: [] }
  const teamNameById = new Map(
    ((teams ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  )
  const sourceTeamName = input.sourceTeamId ? teamNameById.get(input.sourceTeamId) : null
  const targetTeamName = input.targetTeamId ? teamNameById.get(input.targetTeamId) : null

  // Contexte : description neutre, descriptive
  let context: string
  if (sourceTeamName && targetTeamName) {
    context = `${subjectLabel} bascule de l'équipe « ${sourceTeamName} » vers « ${targetTeamName} ».`
  } else if (sourceTeamName) {
    context = `${subjectLabel} quitte l'équipe « ${sourceTeamName} ».`
  } else if (targetTeamName) {
    context = `${subjectLabel} rejoint l'équipe « ${targetTeamName} ».`
  } else {
    context = `Passage de témoin concernant ${subjectLabel}.`
  }

  // Sites : on récupère ceux couverts via les équipes actives du sujet
  // (priorité à l'équipe source si fournie)
  let sourceSites: SiteContextRow[] = []
  if (input.sourceTeamId) {
    sourceSites = await listSitesCoveredByTeam(input.sourceTeamId)
  } else {
    sourceSites = await listSitesCoveredViaUserTeams(input.subjectUserId)
  }
  const cappedSites = sourceSites.slice(0, SITE_CAP)

  // Construire chaque site context (en parallèle)
  const sites = await Promise.all(cappedSites.map((s) => buildSiteContextEntry(s)))

  const title = sourceTeamName && targetTeamName
    ? `Passage de témoin — ${subjectLabel} (${sourceTeamName} → ${targetTeamName})`
    : sourceTeamName
      ? `Passage de témoin — ${subjectLabel} quitte ${sourceTeamName}`
      : targetTeamName
        ? `Passage de témoin — ${subjectLabel} rejoint ${targetTeamName}`
        : `Passage de témoin — ${subjectLabel}`

  return {
    title,
    payload: {
      generatedAt: new Date().toISOString(),
      context,
      sites,
      manualNotes: null,
    },
  }
}

export interface BuildTeamTakesSiteInput {
  targetTeamId: string
  siteId: string
}

/**
 * Compile le brief pour une équipe qui prend un nouveau site.
 *
 * Le brief ne contient qu'UN site, mais avec toute sa mémoire (à savoir,
 * anomalies, documents) + les équipes voisines qui le connaissent déjà.
 */
export async function buildTeamTakesSitePayload(
  input: BuildTeamTakesSiteInput,
): Promise<{ payload: HandoverPayload; title: string }> {
  const admin = createAdminClient()

  // Récupérer team + site
  const [{ data: team }, { data: site }] = await Promise.all([
    admin
      .from('teams')
      .select('id, name')
      .eq('id', input.targetTeamId)
      .is('deleted_at', null)
      .maybeSingle(),
    admin
      .from('sites')
      .select('id, name, contract:contracts(id, name), client:clients(name)')
      .eq('id', input.siteId)
      .is('deleted_at', null)
      .maybeSingle(),
  ])
  if (!team || !site) {
    throw new Error('Équipe ou site introuvable')
  }
  const contract = pickOne(site.contract) as { id?: string; name?: string } | null
  const client = pickOne(site.client) as { name?: string } | null

  // Compteurs intervention pour ce site (toutes équipes confondues, pour
  // donner le contexte de fréquentation du lieu)
  const { data: allInterv } = await admin
    .from('interventions')
    .select(`
      id, scheduled_for, status,
      mission:missions!inner(site_id)
    `)
    .order('scheduled_for', { ascending: false })
    .limit(200)
  type IRow = {
    id: string
    scheduled_for: string | null
    status: string
    mission: { site_id: string } | { site_id: string }[]
  }
  let interventionsCount = 0
  let lastInterventionDate: string | null = null
  for (const r of (allInterv ?? []) as IRow[]) {
    const m = pickOne(r.mission)
    if (!m || m.site_id !== site.id) continue
    if (!['in_progress', 'completed', 'validated'].includes(r.status)) continue
    interventionsCount += 1
    if (
      r.scheduled_for &&
      (!lastInterventionDate || r.scheduled_for > lastInterventionDate)
    ) {
      lastInterventionDate = r.scheduled_for
    }
  }

  const base: SiteContextRow = {
    site_id: site.id,
    site_name: site.name,
    contract_id: contract?.id ?? null,
    contract_name: contract?.name ?? null,
    client_name: client?.name ?? null,
    interventionsCount,
    lastInterventionDate,
  }
  const siteEntry = await buildSiteContextEntry(base)

  return {
    title: `Brief site « ${site.name} » — pour ${team.name}`,
    payload: {
      generatedAt: new Date().toISOString(),
      context: `L'équipe « ${team.name} » prend en charge le site « ${site.name} ». Voici la mémoire accumulée par les équipes qui l'ont couvert avant.`,
      sites: [siteEntry],
      manualNotes: null,
    },
  }
}

// ----------------------------------------------------------------------------
// CRUD handover_briefs
// ----------------------------------------------------------------------------

export interface CreateHandoverBriefInput {
  kind: HandoverKind
  sourceTeamId?: string | null
  targetTeamId?: string | null
  subjectUserId?: string | null
  siteId?: string | null
  payload: HandoverPayload
  title: string
  createdBy: string
  /** Date d'effet du passage de témoin (YYYY-MM-DD), optionnelle. */
  effectiveDate?: string | null
}

export async function createHandoverBrief(
  input: CreateHandoverBriefInput,
): Promise<DbHandoverBrief> {
  const admin = createAdminClient()
  const orgId = await getOrgId()
  const { data, error } = await admin
    .from('handover_briefs')
    .insert({
      kind: input.kind,
      source_team_id: input.sourceTeamId ?? null,
      target_team_id: input.targetTeamId ?? null,
      subject_user_id: input.subjectUserId ?? null,
      site_id: input.siteId ?? null,
      payload: input.payload,
      title: input.title,
      status: 'draft',
      effective_date: input.effectiveDate ?? null,
      created_by: input.createdBy,
      ...(orgId ? { organization_id: orgId } : {}),
    })
    .select('*')
    .single()
  if (error) throw error
  return data as DbHandoverBrief
}

export async function getHandoverBrief(id: string): Promise<DbHandoverBrief | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('handover_briefs')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data as DbHandoverBrief | null
}

export async function getHandoverBriefByToken(
  token: string,
): Promise<DbHandoverBrief | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('handover_briefs')
    .select('*')
    .eq('shared_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data as DbHandoverBrief | null
}

export interface HandoverListFilter {
  status?: HandoverStatus
  limit?: number
}

export async function listHandoverBriefs(
  filter: HandoverListFilter = {},
): Promise<DbHandoverBrief[]> {
  const admin = createAdminClient()
  const orgId = await getOrgId()
  let q = admin
    .from('handover_briefs')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (filter.status) q = q.eq('status', filter.status)
  if (filter.limit) q = q.limit(filter.limit)
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbHandoverBrief[]
}

/**
 * Passations rattachées à UN chantier — la passation se prépare depuis le
 * chantier qu'elle transmet, pas depuis une liste globale.
 *
 * Isolation P1 : FAIL-CLOSED — pas d'organisation → aucune passation.
 */
export async function listHandoverBriefsBySite(
  siteId: string,
  limit = 5,
): Promise<DbHandoverBrief[]> {
  const admin = createAdminClient()
  const orgId = await getOrgId()
  if (!orgId) return []
  const { data, error } = await admin
    .from('handover_briefs')
    .select('*')
    .eq('site_id', siteId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as DbHandoverBrief[]
}

/**
 * Briefs de passation qu'un chef d'équipe doit pouvoir RETROUVER dans l'app
 * terrain (`/m`) — même si le lien SMS est perdu (P1 audit live 2026-05-26).
 *
 * Pertinents pour le chef = briefs PARTAGÉS (donc dotés d'un shared_token, donc
 * ouvrables via /h/[token] sans login) ET :
 *   - destinés à une de ses équipes (target_team_id), OU
 *   - qui le concernent personnellement (subject_user_id).
 * On exclut les archivés / expirés. Sujet = la mémoire transmise, jamais un
 * jugement sur la personne.
 */
export async function listSharedHandoverBriefsForChef(
  userId: string,
  teamIds: string[],
): Promise<DbHandoverBrief[]> {
  const admin = createAdminClient()
  const orFilters = [`subject_user_id.eq.${userId}`]
  if (teamIds.length > 0) {
    orFilters.push(`target_team_id.in.(${teamIds.join(',')})`)
  }
  const { data, error } = await admin
    .from('handover_briefs')
    .select('*')
    .in('status', ['shared', 'acknowledged'])
    .not('shared_token', 'is', null)
    .is('deleted_at', null)
    .or(orFilters.join(','))
    .order('shared_at', { ascending: false })
    .limit(10)
  if (error) throw error
  const now = Date.now()
  return (data ?? []).filter(
    (b) => !b.expires_at || new Date(b.expires_at).getTime() > now,
  ) as DbHandoverBrief[]
}

export async function countHandoverBriefsByStatus(): Promise<Record<HandoverStatus, number>> {
  const admin = createAdminClient()
  const orgId = await getOrgId()
  const out: Record<HandoverStatus, number> = {
    draft: 0,
    shared: 0,
    acknowledged: 0,
    archived: 0,
  }
  const statuses: HandoverStatus[] = ['draft', 'shared', 'acknowledged', 'archived']
  await Promise.all(
    statuses.map(async (s) => {
      let q = admin
        .from('handover_briefs')
        .select('id', { count: 'exact', head: true })
        .eq('status', s)
        .is('deleted_at', null)
      if (orgId) q = q.eq('organization_id', orgId)
      const { count } = await q
      out[s] = count ?? 0
    }),
  )
  return out
}

export async function updateHandoverManualNotes(
  id: string,
  notes: string | null,
): Promise<void> {
  const admin = createAdminClient()
  const existing = await getHandoverBrief(id)
  if (!existing) throw new Error('Brief introuvable')
  if (existing.status === 'archived') throw new Error('Brief archivé, non modifiable')
  const newPayload: HandoverPayload = {
    ...existing.payload,
    manualNotes: notes && notes.trim().length > 0 ? notes.trim() : null,
  }
  const { error } = await admin
    .from('handover_briefs')
    .update({ payload: newPayload })
    .eq('id', id)
  if (error) throw error
}

export async function shareHandoverBrief(
  id: string,
  expiresAt: Date,
): Promise<{ token: string }> {
  const admin = createAdminClient()
  // Token URL-safe — pattern aligné sur proof_share_tokens
  const { randomBytes } = await import('node:crypto')
  const token = randomBytes(24).toString('base64url')
  const { error } = await admin
    .from('handover_briefs')
    .update({
      shared_token: token,
      shared_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'shared',
    })
    .eq('id', id)
    .is('deleted_at', null) // jamais (re)partager un brief supprimé (audit A2)
  if (error) throw error
  return { token }
}

export async function acknowledgeHandoverBrief(id: string, userId: string): Promise<void> {
  const admin = createAdminClient()
  // Garde-fou DB : on ne « reconnaît » jamais un brief supprimé ou archivé,
  // même via un id forgé (l'UPDATE ne ciblait pas deleted_at/status — audit A2).
  const { error } = await admin
    .from('handover_briefs')
    .update({
      status: 'acknowledged',
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('deleted_at', null)
    .neq('status', 'archived')
  if (error) throw error
}

export async function archiveHandoverBrief(id: string): Promise<void> {
  const admin = createAdminClient()
  // Archiver = mettre de côté, PAS supprimer : le brief reste consultable dans
  // l'onglet « Archivé » (cf. texte de confirmation). On ne touche donc plus à
  // deleted_at ici (corrigé 2026-05-27 — avant, l'archive masquait tout).
  const { error } = await admin
    .from('handover_briefs')
    .update({ status: 'archived' })
    .eq('id', id)
  if (error) throw error
}

/** Suppression (soft) d'un passage de témoin : disparaît de toutes les surfaces
 *  (listes, onglet Archivé, lien public /h/[token]) car les requêtes filtrent
 *  `deleted_at IS NULL`. Donnée conservée en base (doctrine : on ne détruit pas),
 *  restaurable par un admin. */
export async function softDeleteHandoverBrief(id: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('handover_briefs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function recordHandoverShareAccess(token: string): Promise<void> {
  const admin = createAdminClient()
  const { data: brief } = await admin
    .from('handover_briefs')
    .select('id, access_count')
    .eq('shared_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!brief) return
  await admin
    .from('handover_briefs')
    .update({
      last_accessed_at: new Date().toISOString(),
      access_count: (brief.access_count ?? 0) + 1,
    })
    .eq('id', brief.id)
}

// ----------------------------------------------------------------------------
// « Faire respirer » la page /handovers — agrégats descriptifs pour rendre la
// continuité VIVANTE même quand il n'y a aucun brief à transmettre.
// Vincent 2026-05-22 — P0 « décrire → orchestrer ».
//
// Doctrine : volume de mémoire PRÉSERVÉE, jamais score ni performance. Sujet =
// la mémoire / le lieu. Le seul nom de personne autorisé est « reconnu par X »
// (fait de processus : qui a accusé réception d'une passation), jamais évaluatif.
// ----------------------------------------------------------------------------

/** Volume de mémoire portée par les briefs créés ce mois-ci (préservée, pas score). */
export interface MemoryTransmittedSummary {
  briefsCount: number
  sitesCovered: number
  anomalies: number
  documents: number
  aSavoir: number
  relayTeams: number
}

/**
 * Agrège ce que les passages de témoin du mois courant ont mis en mémoire.
 * Inclut les briefs archivés (la mémoire a quand même été transmise).
 */
export async function getMemoryTransmittedThisMonth(): Promise<MemoryTransmittedSummary> {
  const admin = createAdminClient()
  const orgId = await getOrgId()
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)

  let qMem = admin
    .from('handover_briefs')
    .select('payload, created_at')
    .gte('created_at', start.toISOString())
  if (orgId) qMem = qMem.eq('organization_id', orgId)
  const { data } = await qMem

  const briefs = (data ?? []) as Array<{ payload: HandoverPayload | null }>
  const sites = new Set<string>()
  const relayTeams = new Set<string>()
  let anomalies = 0
  let documents = 0
  let aSavoir = 0
  for (const b of briefs) {
    for (const s of b.payload?.sites ?? []) {
      sites.add(s.site_id)
      anomalies += s.recentAnomalies?.length ?? 0
      documents += s.documents?.length ?? 0
      aSavoir += s.aSavoir?.length ?? 0
      for (const t of s.neighborTeams ?? []) relayTeams.add(t.team_id)
    }
  }
  return {
    briefsCount: briefs.length,
    sitesCovered: sites.size,
    anomalies,
    documents,
    aSavoir,
    relayTeams: relayTeams.size,
  }
}

/** Entrée de la timeline « Dernières passations » (tous statuts confondus). */
export interface RecentPassationEntry {
  id: string
  title: string
  kind: HandoverKind
  status: HandoverStatus
  createdAt: string
  sitesCount: number
  accessCount: number
  /** Nom de la personne ayant accusé réception (fait de processus). */
  acknowledgedByLabel: string | null
  acknowledgedAt: string | null
  targetTeamName: string | null
  /** True si archivé (soft-deleted) → pas de lien vers le détail. */
  isArchived: boolean
}

/**
 * Dernières passations, tous statuts (y compris archivées), pour montrer que
 * la continuité est vivante. Ne filtre PAS deleted_at (les archives comptent).
 */
export async function listRecentPassations(limit = 6): Promise<RecentPassationEntry[]> {
  const admin = createAdminClient()
  const orgId = await getOrgId()
  let qPassations = admin
    .from('handover_briefs')
    .select(
      'id, title, kind, status, created_at, deleted_at, access_count, acknowledged_by, acknowledged_at, target_team_id, payload',
    )
    .order('created_at', { ascending: false })
    .limit(limit)
  if (orgId) qPassations = qPassations.eq('organization_id', orgId)
  const { data } = await qPassations

  type Row = {
    id: string
    title: string
    kind: HandoverKind
    status: HandoverStatus
    created_at: string
    deleted_at: string | null
    access_count: number | null
    acknowledged_by: string | null
    acknowledged_at: string | null
    target_team_id: string | null
    payload: HandoverPayload | null
  }
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return []

  const ackIds = Array.from(
    new Set(rows.map((r) => r.acknowledged_by).filter((v): v is string => !!v)),
  )
  const teamIds = Array.from(
    new Set(rows.map((r) => r.target_team_id).filter((v): v is string => !!v)),
  )
  const [usersRes, teamsRes] = await Promise.all([
    ackIds.length
      ? admin.from('users').select('id, full_name, email').in('id', ackIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string }> }),
    teamIds.length
      ? admin.from('teams').select('id, name').in('id', teamIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])
  const userById = new Map(
    ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>).map(
      (u) => [u.id, (u.full_name ?? '').trim() || u.email.split('@')[0] || u.email],
    ),
  )
  const teamById = new Map(
    ((teamsRes.data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  )

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    createdAt: r.created_at,
    sitesCount: r.payload?.sites?.length ?? 0,
    accessCount: r.access_count ?? 0,
    acknowledgedByLabel: r.acknowledged_by ? userById.get(r.acknowledged_by) ?? null : null,
    acknowledgedAt: r.acknowledged_at,
    targetTeamName: r.target_team_id ? teamById.get(r.target_team_id) ?? null : null,
    isArchived: r.status === 'archived' || r.deleted_at !== null,
  }))
}

/** Carte « à savoir » vivante (consigne descriptive persistante d'un site). */
export interface LivingASavoirCard {
  id: string
  site_id: string
  site_name: string
  body: string
  notedAt: string
}

/**
 * Quelques « à savoir » actuellement actifs (un par site pour la variété).
 * Matière brute de la mémoire transmise — sujet = le lieu, format passif.
 */
export async function listLivingASavoir(limit = 4): Promise<LivingASavoirCard[]> {
  const admin = createAdminClient()
  const orgId = await getOrgId()
  const today = new Date().toISOString().slice(0, 10)
  let qASavoir = admin
    .from('site_notes')
    .select('id, body, created_at, kind, active_until, site:sites!inner(id, name, deleted_at)')
    .eq('kind', 'a_savoir')
    .is('deleted_at', null)
    .or(`active_until.is.null,active_until.gte.${today}`)
    .order('created_at', { ascending: false })
    .limit(limit * 4)
  if (orgId) qASavoir = qASavoir.eq('organization_id', orgId)
  const { data } = await qASavoir

  type Row = {
    id: string
    body: string
    created_at: string
    site: { id: string; name: string; deleted_at: string | null } | { id: string; name: string; deleted_at: string | null }[] | null
  }
  const out: LivingASavoirCard[] = []
  const seenSites = new Set<string>()
  for (const r of (data ?? []) as Row[]) {
    const site = pickOne(r.site)
    if (!site?.id || !site.name || site.deleted_at) continue
    if (seenSites.has(site.id)) continue // un par site
    seenSites.add(site.id)
    out.push({
      id: r.id,
      site_id: site.id,
      site_name: site.name,
      body: r.body,
      notedAt: r.created_at,
    })
    if (out.length >= limit) break
  }
  return out
}

// Re-export pour confort sur les pages
export { listTeamCompanions }
