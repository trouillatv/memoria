// Slice B.0 — Dossier de preuves : helper de recherche transversal.
//
// Doctrine impérative :
//   - Wedge émotionnel : <30s entre « j'ai pas la preuve » et « la voilà ».
//     Donc requête optimisée pour le retour rapide (objectif <500ms).
//   - Anonymisation par défaut : on ne retourne JAMAIS d'identifiants d'agents.
//     `team[]` reste interne à la DB, hors de cette surface.
//   - Sobriété calme : aucun champ de score, de performance, de jugement.
//     Uniquement des FAITS : compteurs photos / anomalies / validations.
//   - Ordre antichronologique : le DG regarde « la dernière intervention sur
//     ce site », pas « la première de 2022 ». Le plus récent en haut, point.
//
// Stratégie technique :
//   1) Resolve siteIds matchant le filtre site OU le mot-clé (sur site.name) ;
//      si filtre site exact présent, on ne mappe que celui-là.
//   2) Resolve missionIds via sites (filtre site + recherche site.name).
//   3) Query interventions avec un select join missions→sites→contracts.
//      Filtre OR sur mission.name OR site.name (résolu côté code en pré-set
//      de mission_ids) — PostgREST ne supporte pas le OR cross-table fluide.
//   4) Compute counts photos/anomalies/validations groupés par intervention_id
//      via deux requêtes séparées (group by) puis map côté code.
//
// On garde la logique en TS simple et lisible, quitte à faire 4 requêtes au
// lieu d'1 SQL exotique. C'est plus testable et reste très rapide tant que
// le résultat tient en quelques centaines de lignes.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'

// ----------------------------------------------------------------------------
// Types publics
// ----------------------------------------------------------------------------

export interface ProofSearchInput {
  /** Mot-clé matché sur mission.name OU site.name (ILIKE, anchored par %). */
  search?: string
  /** Filtre site exact (UUID). Mutuellement exclusif avec contractId. */
  siteId?: string
  /** Filtre contrat (UUID) — inclut toutes les interventions de tous les sites du contrat.
   *  Mutuellement exclusif avec siteId. */
  contractId?: string
  /** Borne basse inclusive (yyyy-mm-dd). Comparée à COALESCE(scheduled_for,
   * scheduled_at::date, executed_at::date). */
  dateFrom?: string
  /** Borne haute inclusive (yyyy-mm-dd). */
  dateTo?: string
  /** Filtre status intervention (planned | in_progress | completed | validated | skipped). */
  status?: string
  /** Pagination offset (0-based). */
  offset?: number
  /** Pagination limit (default 50, max 200). */
  limit?: number
}

export interface ProofIntervention {
  id: string
  /** Titre affichable : mission.name (fallback "Intervention"). */
  title: string
  /** Date logique (yyyy-mm-dd) si disponible. */
  scheduled_for: string | null
  /** Horodatage planifié (timestamptz). */
  scheduled_at: string
  /** Horodatage exécuté (timestamptz) si présent. */
  executed_at: string | null
  status: string
  skipped_at: string | null
  skipped_reason: string | null
  mission_id: string
  mission_name: string
  site_id: string
  site_name: string
  contract_id: string | null
  contract_name: string | null
  client_name: string | null
  photosCount: number
  anomaliesCount: number
  anomaliesResolvedCount: number
  validationsCount: number
}

export interface ProofSearchResult {
  items: ProofIntervention[]
  total: number
}

// ----------------------------------------------------------------------------
// Helper principal
// ----------------------------------------------------------------------------

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function searchProofs(input: ProofSearchInput = {}): Promise<ProofSearchResult> {
  const supabase = createAdminClient()
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return { items: [], total: 0 }
  const offset = Math.max(0, input.offset ?? 0)
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT))

  // ---- 1. Pré-résolution des mission_ids candidats si filtre site ou recherche
  //         qui peut matcher sur site.name.
  // Approche : on calcule un set d'ids missions par croisement des filtres.
  // - Si siteId fourni → set missions sur ce site (et recherche éventuelle sur mission.name).
  // - Si search fourni sans siteId → set missions dont (site.name ILIKE %s%) UNION missions
  //   dont (name ILIKE %s%).
  // - Si ni siteId ni search → pas de pré-filtrage missions (NULL = pas de restriction).

  const escaped = input.search ? escapeIlike(input.search) : null

  let candidateMissionIds: string[] | null = null

  if (input.contractId && !input.siteId) {
    // Filtre par contrat : résoudre sites → missions.
    const { data: contractSites, error: csErr } = await supabase
      .from('sites')
      .select('id')
      .eq('contract_id', input.contractId)
      .is('deleted_at', null)
    if (csErr) throw csErr
    const contractSiteIds = (contractSites ?? []).map((s) => s.id)
    if (contractSiteIds.length === 0) return { items: [], total: 0 }
    let q = supabase
      .from('missions')
      .select('id')
      .in('site_id', contractSiteIds)
      .is('deleted_at', null)
    if (escaped) q = q.ilike('name', `%${escaped}%`)
    const { data: contractMissions, error: cmErr } = await q
    if (cmErr) throw cmErr
    candidateMissionIds = (contractMissions ?? []).map((m) => m.id)
    if (candidateMissionIds.length === 0) return { items: [], total: 0 }
  } else if (input.siteId) {
    // Bound to that site, optional name match.
    let q = supabase
      .from('missions')
      .select('id, name, site_id')
      .eq('site_id', input.siteId)
      .is('deleted_at', null)
    if (escaped) q = q.ilike('name', `%${escaped}%`)
    const { data, error } = await q
    if (error) throw error
    candidateMissionIds = (data ?? []).map((m) => m.id)
    if (escaped) {
      // Un site dont le nom match peut aussi compter — mais on est borné à siteId, donc
      // si le site lui-même match, on prend toutes ses missions.
      const { data: site, error: sErr } = await supabase
        .from('sites')
        .select('id, name')
        .eq('id', input.siteId)
        .is('deleted_at', null)
        .maybeSingle()
      if (sErr) throw sErr
      if (site && site.name.toLowerCase().includes(input.search!.toLowerCase())) {
        const { data: allMissions, error: amErr } = await supabase
          .from('missions')
          .select('id')
          .eq('site_id', input.siteId)
          .is('deleted_at', null)
        if (amErr) throw amErr
        const ids = (allMissions ?? []).map((m) => m.id)
        candidateMissionIds = Array.from(new Set([...(candidateMissionIds ?? []), ...ids]))
      }
    }
    if (candidateMissionIds.length === 0) return { items: [], total: 0 }
  } else if (escaped) {
    // Sans siteId, mais recherche → résoudre via missions ET sites.
    const [missionsRes, sitesRes] = await Promise.all([
      supabase
        .from('missions')
        .select('id')
        .ilike('name', `%${escaped}%`)
        .is('deleted_at', null),
      supabase
        .from('sites')
        .select('id')
        .ilike('name', `%${escaped}%`)
        .is('deleted_at', null)
        .in('organization_id', orgIds),
    ])
    if (missionsRes.error) throw missionsRes.error
    if (sitesRes.error) throw sitesRes.error
    const fromMissionName = (missionsRes.data ?? []).map((m) => m.id)
    const siteIds = (sitesRes.data ?? []).map((s) => s.id)
    let fromSiteName: string[] = []
    if (siteIds.length > 0) {
      const { data, error } = await supabase
        .from('missions')
        .select('id')
        .in('site_id', siteIds)
        .is('deleted_at', null)
      if (error) throw error
      fromSiteName = (data ?? []).map((m) => m.id)
    }
    candidateMissionIds = Array.from(new Set([...fromMissionName, ...fromSiteName]))
    if (candidateMissionIds.length === 0) return { items: [], total: 0 }
  }

  // ---- 2. Query interventions filtrées + select join missions/sites/contracts.
  let q = supabase
    .from('interventions')
    .select(
      `
      id,
      mission_id,
      scheduled_at,
      scheduled_for,
      executed_at,
      status,
      skipped_at,
      skipped_reason,
      mission:missions!inner(
        id,
        name,
        site:sites!inner(
          id,
          name,
          contract:contracts(id, name, client_name)
        )
      )
    `,
      { count: 'exact' },
    )
    // Ordre : antichronologique sur scheduled_at (timestamptz, toujours non nul).
    // Note : on aurait aimé COALESCE(executed_at, scheduled_at) DESC, mais
    // PostgREST ne le supporte pas natif. scheduled_at est très proche en pratique,
    // et c'est cohérent (la planification c'est l'événement, l'exécution suit).
    .order('scheduled_at', { ascending: false })

  if (candidateMissionIds) {
    q = q.in('mission_id', candidateMissionIds)
  }
  q = q.in('organization_id', orgIds)
  if (input.status) {
    q = q.eq('status', input.status)
  }
  if (input.dateFrom) {
    const fromIso = `${input.dateFrom}T00:00:00.000Z`
    q = q.gte('scheduled_at', fromIso)
  }
  if (input.dateTo) {
    // Inclusif : on étend au lendemain à minuit exclu.
    const dayAfter = addDaysIso(input.dateTo, 1)
    q = q.lt('scheduled_at', `${dayAfter}T00:00:00.000Z`)
  }

  q = q.range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) throw error

  type RawJoin = {
    id: string
    mission_id: string
    scheduled_at: string
    scheduled_for: string | null
    executed_at: string | null
    status: string
    skipped_at: string | null
    skipped_reason: string | null
    mission?: unknown
  }
  const raw = (data ?? []) as unknown as RawJoin[]

  if (raw.length === 0) return { items: [], total: count ?? 0 }

  const interventionIds = raw.map((r) => r.id)

  // ---- 3. Compteurs photos / anomalies / validations groupés.
  // PostgREST ne fait pas de COUNT GROUP BY natif. On récupère les rows minimales
  // et on compte côté code. Volume borné par `limit` (50 par défaut) * #photos
  // ≈ quelques centaines de rows max. OK.
  const [photosRes, anomaliesRes, validationsRes] = await Promise.all([
    supabase
      .from('intervention_photos')
      .select('intervention_id')
      .in('intervention_id', interventionIds),
    supabase
      .from('intervention_anomalies')
      .select('intervention_id, status')
      .in('intervention_id', interventionIds),
    supabase
      .from('intervention_validations')
      .select('intervention_id')
      .in('intervention_id', interventionIds),
  ])
  if (photosRes.error) throw photosRes.error
  if (anomaliesRes.error) throw anomaliesRes.error
  if (validationsRes.error) throw validationsRes.error

  const photosByInt = new Map<string, number>()
  for (const p of photosRes.data ?? []) {
    const k = (p as { intervention_id: string }).intervention_id
    photosByInt.set(k, (photosByInt.get(k) ?? 0) + 1)
  }
  const anomaliesByInt = new Map<string, { total: number; resolved: number }>()
  for (const a of anomaliesRes.data ?? []) {
    const row = a as { intervention_id: string; status: string }
    const cur = anomaliesByInt.get(row.intervention_id) ?? { total: 0, resolved: 0 }
    cur.total += 1
    if (row.status === 'resolved') cur.resolved += 1
    anomaliesByInt.set(row.intervention_id, cur)
  }
  const validationsByInt = new Map<string, number>()
  for (const v of validationsRes.data ?? []) {
    const k = (v as { intervention_id: string }).intervention_id
    validationsByInt.set(k, (validationsByInt.get(k) ?? 0) + 1)
  }

  // ---- 4. Map raw rows → ProofIntervention.
  function pickOne<T>(value: unknown): T | null {
    if (Array.isArray(value)) return (value[0] as T) ?? null
    return (value as T | null) ?? null
  }

  const items: ProofIntervention[] = raw.map((r) => {
    const missionRaw = pickOne<{
      id: string
      name: string
      site?: unknown
    }>(r.mission)
    const siteRaw = missionRaw
      ? pickOne<{ id: string; name: string; contract?: unknown }>(missionRaw.site)
      : null
    const contractRaw = siteRaw
      ? pickOne<{ id: string; name: string; client_name: string }>(siteRaw.contract)
      : null
    const anomalies = anomaliesByInt.get(r.id) ?? { total: 0, resolved: 0 }
    return {
      id: r.id,
      title: missionRaw?.name ?? 'Intervention',
      scheduled_for: r.scheduled_for,
      scheduled_at: r.scheduled_at,
      executed_at: r.executed_at,
      status: r.status,
      skipped_at: r.skipped_at,
      skipped_reason: r.skipped_reason,
      mission_id: r.mission_id,
      mission_name: missionRaw?.name ?? '',
      site_id: siteRaw?.id ?? '',
      site_name: siteRaw?.name ?? '',
      contract_id: contractRaw?.id ?? null,
      contract_name: contractRaw?.name ?? null,
      client_name: contractRaw?.client_name ?? null,
      photosCount: photosByInt.get(r.id) ?? 0,
      anomaliesCount: anomalies.total,
      anomaliesResolvedCount: anomalies.resolved,
      validationsCount: validationsByInt.get(r.id) ?? 0,
    }
  })

  return { items, total: count ?? 0 }
}

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------

function escapeIlike(input: string): string {
  // Échappe les caractères qui ont une signification SQL ILIKE.
  return input.replace(/[%_\\]/g, (m) => `\\${m}`)
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ============================================================================
// Slice B.1 — getProofDetail : la profondeur de la preuve.
// ============================================================================
//
// Doctrine impérative :
//   - Anonymisation par défaut. team_size = taille du tableau (un compteur,
//     pas une liste de noms). Validations exposent un rôle ("Équipe
//     superviseur"), jamais une identité.
//   - Tous les FAITS nécessaires en une seule passe DB. Le wedge est <3s
//     entre clic sur ligne et page utile.
//   - Calme : aucun jugement, aucun score, aucune métrique de performance.
//   - Photos via signed URL valides 1h (helper storage existant). Suffisant
//     pour la session de consultation, pas de fuite long-terme.

export interface ProofPhoto {
  id: string
  url: string
  thumbnail_url?: string
  caption: string | null
  taken_at: string
  intervention_id: string
  checklist_item_id: string | null
  anomaly_id: string | null
  kind: string
}

export interface ProofAnomaly {
  id: string
  description: string
  reported_at: string
  resolved_at: string | null
  resolution_note: string | null
  photos: ProofPhoto[]
  category: string
  status: string
}

export interface ProofValidation {
  id: string
  validated_at: string
  comment: string | null
  /** Rôle anonymisé : 'admin' | 'manager'. Le front render "Équipe superviseur". */
  validator_role: string
}

export interface ProofChecklistItem {
  id: string
  label: string
  completed: boolean
  completed_at: string | null
  required: boolean
  position: number
  /** Entreprise externe ayant exécuté cette tâche (contribution), si déléguée. */
  executed_by_company: string | null
  executed_at: string | null
}

/** Contribution externe (sous-traitant / livreur) sur une partie de l'intervention.
 *  Le nom de l'ENTREPRISE est une preuve contractuelle — affiché même en mode
 *  anonymisé (≠ identité d'un salarié interne). */
export interface ProofExternalContribution {
  id: string
  company: string
  validated_at: string | null
  comment: string | null
  /** Signature manuscrite (data URL PNG) — preuve d'engagement de l'externe. */
  signature_url: string | null
  tasksDone: number
  tasksTotal: number
  photosCount: number
}

export interface ProofDetail {
  id: string
  mission_id: string
  mission_name: string
  site_id: string
  site_name: string
  site_address: string | null
  contract_id: string | null
  contract_name: string | null
  client_name: string | null
  scheduled_for: string | null
  scheduled_at: string
  executed_at: string | null
  status: string
  skipped_at: string | null
  skipped_reason: string | null
  /** Taille anonymisée de l'équipe terrain (compteur, jamais les noms). */
  team_size: number
  /** Durée en minutes calculée si executed_at + scheduled_at disponibles. */
  duration_minutes: number | null
  notes: string | null
  checklist: ProofChecklistItem[]
  photos: ProofPhoto[]
  anomalies: ProofAnomaly[]
  validations: ProofValidation[]
  external_contributions: ProofExternalContribution[]
}

export async function getProofDetail(interventionId: string): Promise<ProofDetail | null> {
  const supabase = createAdminClient()

  // 1. Intervention + mission + site + contract en une jointure.
  const { data: rawIntervention, error: intErr } = await supabase
    .from('interventions')
    .select(
      `
      id,
      mission_id,
      scheduled_at,
      scheduled_for,
      executed_at,
      status,
      skipped_at,
      skipped_reason,
      team,
      notes,
      mission:missions!inner(
        id,
        name,
        site:sites!inner(
          id,
          name,
          address,
          contract:contracts(id, name, client_name)
        )
      )
    `,
    )
    .eq('id', interventionId)
    .maybeSingle()

  if (intErr) throw intErr
  if (!rawIntervention) return null

  type RawIntervention = {
    id: string
    mission_id: string
    scheduled_at: string
    scheduled_for: string | null
    executed_at: string | null
    status: string
    skipped_at: string | null
    skipped_reason: string | null
    team: string[] | null
    notes: string | null
    mission?: unknown
  }
  const r = rawIntervention as unknown as RawIntervention

  function pickOne<T>(value: unknown): T | null {
    if (Array.isArray(value)) return (value[0] as T) ?? null
    return (value as T | null) ?? null
  }

  const missionRaw = pickOne<{ id: string; name: string; site?: unknown }>(r.mission)
  const siteRaw = missionRaw
    ? pickOne<{ id: string; name: string; address: string | null; contract?: unknown }>(
        missionRaw.site,
      )
    : null
  const contractRaw = siteRaw
    ? pickOne<{ id: string; name: string; client_name: string }>(siteRaw.contract)
    : null

  // 2. Checklist, photos, anomalies, validations en parallèle.
  const [checklistRes, photosRes, anomaliesRes, validationsRes] = await Promise.all([
    supabase
      .from('intervention_checklist_items')
      .select('id, label, required, position, done, done_at, executed_by_token_id, executed_at')
      .eq('intervention_id', interventionId)
      .order('position', { ascending: true }),
    supabase
      .from('intervention_photos')
      .select('id, storage_path, caption, taken_at, kind, checklist_item_id, intervention_id, external_token_id')
      .eq('intervention_id', interventionId)
      .order('taken_at', { ascending: true }),
    supabase
      .from('intervention_anomalies')
      .select(
        'id, description, category, status, resolved_at, resolution_note, created_at',
      )
      .eq('intervention_id', interventionId)
      .order('created_at', { ascending: true }),
    supabase
      .from('intervention_validations')
      .select('id, validated_at, comment, validated_by')
      .eq('intervention_id', interventionId)
      .order('validated_at', { ascending: true }),
  ])

  if (checklistRes.error) throw checklistRes.error
  if (photosRes.error) throw photosRes.error
  if (anomaliesRes.error) throw anomaliesRes.error
  if (validationsRes.error) throw validationsRes.error

  // 3. Photos : schéma Phase 5 ne porte pas de lien direct anomaly_id sur
  //    intervention_photos. Le lien anomalies↔photos est implicite via
  //    `kind = 'anomaly'` (toutes les photos d'anomalie d'une même intervention
  //    sont rattachées globalement). On expose anomaly_id=null par défaut ;
  //    la section "Anomalies" agrège séparément les photos `kind='anomaly'`
  //    de la même intervention au niveau du rendu si besoin (B.5 polish).
  type RawPhoto = {
    id: string
    storage_path: string
    caption: string | null
    taken_at: string
    kind: string
    checklist_item_id: string | null
    intervention_id: string
    external_token_id: string | null
  }
  const rawPhotos = (photosRes.data ?? []) as unknown as RawPhoto[]

  // 4. Signed URLs en batch (variante thumb 400×400 — gain bande passante).
  const signedMap = await getSignedPhotoUrlsThumb(rawPhotos.map((p) => p.storage_path))

  const proofPhotos: ProofPhoto[] = rawPhotos.map((p) => ({
    id: p.id,
    url: signedMap.get(p.storage_path) ?? '',
    caption: p.caption,
    taken_at: p.taken_at,
    intervention_id: p.intervention_id,
    checklist_item_id: p.checklist_item_id,
    anomaly_id: null,
    kind: p.kind,
  }))

  // 5. Validators → roles (anonymisé : on rapporte le rôle, pas l'identité).
  type RawValidation = {
    id: string
    validated_at: string
    comment: string | null
    validated_by: string
  }
  const rawValidations = (validationsRes.data ?? []) as unknown as RawValidation[]

  const validatorIds = Array.from(new Set(rawValidations.map((v) => v.validated_by)))
  const roleByUserId = new Map<string, string>()
  if (validatorIds.length > 0) {
    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('id, role')
      .in('id', validatorIds)
    if (uErr) throw uErr
    for (const u of users ?? []) {
      const row = u as { id: string; role: string }
      roleByUserId.set(row.id, row.role)
    }
  }

  const validations: ProofValidation[] = rawValidations.map((v) => ({
    id: v.id,
    validated_at: v.validated_at,
    comment: v.comment,
    validator_role: roleByUserId.get(v.validated_by) ?? 'manager',
  }))

  // 6. Anomalies enrichies avec leurs photos.
  type RawAnomaly = {
    id: string
    description: string | null
    category: string
    status: string
    resolved_at: string | null
    resolution_note: string | null
    created_at: string
  }
  const rawAnomalies = (anomaliesRes.data ?? []) as unknown as RawAnomaly[]

  // Schéma actuel : pas de FK directe photo→anomalie. Les photos `kind='anomaly'`
  //  d'une intervention sont attachées à la première anomalie reportée (heuristique
  //  visuelle) — la doctrine veut "voir les photos d'anomalie quelque part". Si
  //  zéro anomalie reportée, ces photos restent dans la section Photos générale.
  const anomalyPhotos = proofPhotos.filter((p) => p.kind === 'anomaly')

  const anomalies: ProofAnomaly[] = rawAnomalies.map((a, idx) => ({
    id: a.id,
    description: a.description ?? '',
    category: a.category,
    status: a.status,
    reported_at: a.created_at,
    resolved_at: a.resolved_at,
    resolution_note: a.resolution_note,
    photos: idx === 0 ? anomalyPhotos : [],
  }))

  // 7. Contributions externes : tokens validés (sous-traitants/livreurs) +
  //    périmètre + tâches exécutées + photos. L'entreprise est une preuve.
  const { data: tokenRows } = await supabase
    .from('intervention_tokens')
    .select('id, recipient_label, validated_by_name, validation_comment, validated_at, signature_data_url')
    .eq('intervention_id', interventionId)
    .not('validated_at', 'is', null)
    .order('validated_at', { ascending: true })
  type RawTok = {
    id: string
    recipient_label: string | null
    validated_by_name: string | null
    validation_comment: string | null
    validated_at: string
    signature_data_url: string | null
  }
  const validatedToks = (tokenRows ?? []) as RawTok[]
  const tokenCompany = new Map<string, string>()
  for (const t of validatedToks) {
    tokenCompany.set(t.id, t.validated_by_name ?? t.recipient_label ?? 'Intervenant externe')
  }

  // Périmètre par token (token_items) — fallback toute la checklist si vide.
  const perimeterByToken = new Map<string, number>()
  if (validatedToks.length > 0) {
    const { data: tiRows } = await supabase
      .from('intervention_token_items')
      .select('token_id')
      .in('token_id', validatedToks.map((t) => t.id))
    for (const ti of (tiRows ?? []) as Array<{ token_id: string }>) {
      perimeterByToken.set(ti.token_id, (perimeterByToken.get(ti.token_id) ?? 0) + 1)
    }
  }

  // 8. Checklist mapping (+ entreprise exécutante par tâche).
  type RawChecklist = {
    id: string
    label: string
    required: boolean
    position: number
    done: boolean
    done_at: string | null
    executed_by_token_id: string | null
    executed_at: string | null
  }
  const rawChecklist = (checklistRes.data ?? []) as unknown as RawChecklist[]

  const checklist: ProofChecklistItem[] = rawChecklist.map((c) => ({
    id: c.id,
    label: c.label,
    required: c.required,
    position: c.position,
    completed: c.done,
    completed_at: c.done_at,
    executed_by_company: c.executed_by_token_id ? tokenCompany.get(c.executed_by_token_id) ?? null : null,
    executed_at: c.executed_at,
  }))

  // Bilan par contribution : tâches exécutées + photos.
  const executedByToken = new Map<string, number>()
  for (const c of rawChecklist) {
    if (c.executed_by_token_id) executedByToken.set(c.executed_by_token_id, (executedByToken.get(c.executed_by_token_id) ?? 0) + 1)
  }
  const photosByToken = new Map<string, number>()
  for (const p of rawPhotos) {
    if (p.external_token_id) photosByToken.set(p.external_token_id, (photosByToken.get(p.external_token_id) ?? 0) + 1)
  }
  const externalContributions: ProofExternalContribution[] = validatedToks.map((t) => ({
    id: t.id,
    company: tokenCompany.get(t.id) ?? 'Intervenant externe',
    validated_at: t.validated_at,
    comment: t.validation_comment,
    signature_url: t.signature_data_url,
    tasksDone: executedByToken.get(t.id) ?? 0,
    tasksTotal: perimeterByToken.get(t.id) ?? rawChecklist.length,
    photosCount: photosByToken.get(t.id) ?? 0,
  }))

  // 8. Durée : on préfère executed_at - scheduled_at quand les deux sont là.
  //    En l'état actuel du schéma, on n'a pas de started_at distinct, mais
  //    executed_at marque la fin et scheduled_at la planification. C'est la
  //    meilleure approximation calmement disponible.
  let durationMinutes: number | null = null
  if (r.executed_at && r.scheduled_at) {
    const ms = new Date(r.executed_at).getTime() - new Date(r.scheduled_at).getTime()
    if (ms > 0) {
      durationMinutes = Math.round(ms / 60000)
    }
  }

  // 9. team_size = longueur du tableau (anonymisation stricte).
  const teamSize = Array.isArray(r.team) ? r.team.length : 0

  return {
    id: r.id,
    mission_id: r.mission_id,
    mission_name: missionRaw?.name ?? 'Intervention',
    site_id: siteRaw?.id ?? '',
    site_name: siteRaw?.name ?? '',
    site_address: siteRaw?.address ?? null,
    contract_id: contractRaw?.id ?? null,
    contract_name: contractRaw?.name ?? null,
    client_name: contractRaw?.client_name ?? null,
    scheduled_for: r.scheduled_for,
    scheduled_at: r.scheduled_at,
    executed_at: r.executed_at,
    status: r.status,
    skipped_at: r.skipped_at,
    skipped_reason: r.skipped_reason,
    team_size: teamSize,
    duration_minutes: durationMinutes,
    notes: r.notes,
    checklist,
    photos: proofPhotos,
    anomalies,
    validations,
    external_contributions: externalContributions,
  }
}
