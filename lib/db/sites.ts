import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/db/users'
import { getOpenDossierIdForSite } from '@/lib/db/dossiers'
import { todayLocalIso } from '@/lib/time/local-date'
import type { DbSite, DbSiteNote, SitePhase } from '@/types/db'

// ── Identité du chantier : dossier métier + LIEU (support) ───────────────────
// Décision produit : Chantier = dossier métier, Site = localisation utile DANS le
// chantier (« Lieu du chantier », jamais une entité concurrente). Ce loader
// rassemble ce qui existe réellement ; le reste (MOA/MOE, entreprise) reste absent
// tant qu'il n'a pas de source.

const PHASE_FR: Record<string, string> = {
  prospect: 'Prospect', en_ao: "Appel d'offres", actif: 'Actif', perdu: 'Perdu', archive: 'Archivé',
}

export interface SiteIdentity {
  name: string
  address: string | null
  clientName: string | null
  phaseLabel: string | null
  accessHours: string | null
  accessInstructions: string | null
}

export async function getSiteIdentity(siteId: string): Promise<SiteIdentity | null> {
  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('name, address, client_id, access_hours, access_instructions')
    .eq('id', siteId)
    .maybeSingle()
  if (!site) return null
  const s = site as { name: string; address: string | null; client_id: string | null; access_hours: string | null; access_instructions: string | null }

  let clientName: string | null = null
  if (s.client_id) {
    const { data: c } = await supabase.from('clients').select('name').eq('id', s.client_id).maybeSingle()
    clientName = (c as { name: string } | null)?.name ?? null
  }

  let phaseLabel: string | null = null
  const dossierId = await getOpenDossierIdForSite(siteId).catch(() => null)
  if (dossierId) {
    const { data: d } = await supabase.from('dossiers').select('phase').eq('id', dossierId).maybeSingle()
    const phase = (d as { phase: string } | null)?.phase
    phaseLabel = phase ? PHASE_FR[phase] ?? phase : null
  }

  return { name: s.name, address: s.address, clientName, phaseLabel, accessHours: s.access_hours, accessInstructions: s.access_instructions }
}

// ---------------------------------------------------------------------------
// Identité canonique — anti-doublon
// ---------------------------------------------------------------------------

/**
 * Normalise un nom de site pour la comparaison de similarité.
 * Doit rester cohérent avec la fonction SQL du trigger sites_normalize_name.
 */
export function normalizeSiteName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[-–—_]+/g, ' ')                          // tirets → espace
    .replace(/\s+/g, ' ')                               // collapse
    .trim()
}

/** Clé canonique : "normalized_client::normalized_site" */
export function buildCanonicalSiteKey(clientName: string, siteName: string): string {
  return `${normalizeSiteName(clientName)}::${normalizeSiteName(siteName)}`
}

// Dice coefficient sur trigrammes — équivalent à similarity() de pg_trgm.
function buildTrigrams(s: string): Set<string> {
  const padded = ` ${s} `
  const t = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) t.add(padded.slice(i, i + 3))
  return t
}

export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const ta = buildTrigrams(a)
  const tb = buildTrigrams(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let intersection = 0
  for (const g of ta) if (tb.has(g)) intersection++
  return (2 * intersection) / (ta.size + tb.size)
}

export interface SiteForMatching {
  id: string
  name: string
  normalized_name: string
  canonical_site_key: string | null
  client_id: string | null
  client_display_name: string | null
}

/** Charge tous les sites actifs avec normalized_name pour le matching côté client.
 *  Resilient : si la migration 062 n'est pas encore appliquée (colonnes absentes),
 *  calcule normalized_name en JS plutôt que de crasher la page.
 */
export async function listSitesForMatching(): Promise<SiteForMatching[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  // Tente d'abord avec les nouvelles colonnes (post-migration 062)
  let baseQ = supabase
    .from('sites')
    .select('id, name, normalized_name, canonical_site_key, client_id, client:clients(name)')
    .is('deleted_at', null)
    .order('name')
  if (orgId) baseQ = baseQ.eq('organization_id', orgId)
  const { data, error } = await baseQ

  // Si 42703 (colonne absente) : migration pas encore appliquée → fallback sans ces colonnes
  if (error) {
    if ((error as { code?: string }).code === '42703') {
      let fallbackQ = supabase
        .from('sites')
        .select('id, name, client_id, client:clients(name)')
        .is('deleted_at', null)
        .order('name')
      if (orgId) fallbackQ = fallbackQ.eq('organization_id', orgId)
      const { data: fallback, error: fallbackErr } = await fallbackQ
      if (fallbackErr) throw fallbackErr
      return (fallback ?? []).map((s) => {
        const cl = s.client as { name: string } | { name: string }[] | null
        const clientName = Array.isArray(cl) ? cl[0]?.name ?? null : cl?.name ?? null
        return {
          id: s.id,
          name: s.name,
          normalized_name: normalizeSiteName(s.name),
          canonical_site_key: null,
          client_id: s.client_id,
          client_display_name: clientName,
        }
      })
    }
    throw error
  }

  return (data ?? []).map((s) => {
    const cl = s.client as { name: string } | { name: string }[] | null
    const clientName = Array.isArray(cl) ? cl[0]?.name ?? null : cl?.name ?? null
    return {
      id: s.id,
      name: s.name,
      normalized_name: (s.normalized_name as string | null) ?? normalizeSiteName(s.name),
      canonical_site_key: (s.canonical_site_key as string | null) ?? null,
      client_id: s.client_id,
      client_display_name: clientName,
    }
  })
}

export interface ClientLite { id: string; name: string }

export async function listClients(): Promise<ClientLite[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let q = supabase.from('clients').select('id, name').is('deleted_at', null).order('name')
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as ClientLite[]
}

export interface ContractLite {
  id: string
  name: string
  client_name: string | null
  client_id: string | null
}

export async function listActiveContractsLite(): Promise<ContractLite[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let q = supabase.from('contracts').select('id, name, client_name').is('deleted_at', null).neq('status', 'archived').order('name')
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
  if (error) throw error
  // contracts n'a pas encore de FK client_id directe — on expose null
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    client_name: c.client_name,
    client_id: null,
  }))
}

export async function listSites(): Promise<DbSite[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  let q = supabase.from('sites').select('*').is('deleted_at', null).order('name')
  if (orgId) q = q.eq('organization_id', orgId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function getSiteById(siteId: string): Promise<DbSite | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as DbSite | null
}

export async function listSitesByContract(contractId: string): Promise<DbSite[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

/**
 * Sites de PLUSIEURS contrats en UNE requête (anti-N+1). Utilisé par la liste
 * /contracts pour agréger les signaux mémoire (indexés par site) au contrat.
 * Retour minimal : id, nom, contract_id.
 */
export async function listSitesForContracts(
  contractIds: string[],
): Promise<Array<{ id: string; name: string; contract_id: string }>> {
  if (contractIds.length === 0) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('id, name, contract_id')
    .in('contract_id', contractIds)
    .is('deleted_at', null)
  if (error) throw error
  return (data ?? []) as Array<{ id: string; name: string; contract_id: string }>
}

/**
 * Vue globale d'un site enrichie pour la page /sites :
 *  - rattachement contrat lisible (nom + statut)
 *  - dernière intervention exécutée (pour le seuil d'inactivité 6 mois)
 *  - compteurs de dépendances (pour décider si delete possible)
 */
export interface SiteWithStats extends DbSite {
  contract_name: string | null
  contract_status: string | null
  /** Nom du client (CHT, OPT…) pour le regroupement dans la liste. */
  client_display_name: string | null
  last_intervention_at: string | null
  missions_count: number
  interventions_count: number
  site_notes_count: number
}

/** Liste tous les sites actifs du tenant, enrichis pour l'affichage global. */
export async function listSitesGlobal(): Promise<SiteWithStats[]> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()

  let qSites = supabase
    .from('sites')
    .select('*, contract:contracts(name, status), client:clients(name)')
    .is('deleted_at', null)
    // Les opportunités (prospect/en_ao/perdu) ne polluent pas la grille chantier
    // — elles vivent dans /opportunites. Seuls les dossiers gagnés y figurent.
    .not('phase', 'in', '(prospect,en_ao,perdu)')
    .order('name')
  if (orgId) qSites = qSites.eq('organization_id', orgId)
  const { data: sites, error } = await qSites
  if (error) throw error
  const rows = (sites ?? []) as Array<
    DbSite & {
      contract: { name: string; status: string } | { name: string; status: string }[] | null
      client: { name: string } | { name: string }[] | null
    }
  >

  if (rows.length === 0) return []
  const siteIds = rows.map((s) => s.id)

  // Charge en parallèle : missions par site (1 query), interventions exécutées
  // par site (via missions), site_notes par site.
  const [missionsRes, notesRes] = await Promise.all([
    supabase
      .from('missions')
      .select('id, site_id, deleted_at')
      .in('site_id', siteIds)
      .is('deleted_at', null),
    supabase
      .from('site_notes')
      .select('site_id, deleted_at')
      .in('site_id', siteIds)
      .is('deleted_at', null),
  ])
  if (missionsRes.error) throw missionsRes.error
  if (notesRes.error) throw notesRes.error

  const missionsBySite = new Map<string, string[]>()
  for (const m of (missionsRes.data ?? []) as Array<{ id: string; site_id: string }>) {
    const arr = missionsBySite.get(m.site_id) ?? []
    arr.push(m.id)
    missionsBySite.set(m.site_id, arr)
  }
  const allMissionIds = Array.from(missionsBySite.values()).flat()

  // Interventions exécutées sur ces missions (signal d'activité)
  const interventionsBySite = new Map<string, number>()
  const lastBySite = new Map<string, string>()
  if (allMissionIds.length > 0) {
    const { data: ints, error: iErr } = await supabase
      .from('interventions')
      .select('mission_id, executed_at, status')
      .in('mission_id', allMissionIds)
      .in('status', ['completed', 'validated'])
    if (iErr) throw iErr
    // Map mission → site for reverse lookup
    const missionToSite = new Map<string, string>()
    for (const [sid, mids] of missionsBySite.entries()) {
      for (const mid of mids) missionToSite.set(mid, sid)
    }
    for (const i of (ints ?? []) as Array<{
      mission_id: string
      executed_at: string | null
    }>) {
      const sid = missionToSite.get(i.mission_id)
      if (!sid) continue
      interventionsBySite.set(sid, (interventionsBySite.get(sid) ?? 0) + 1)
      if (i.executed_at) {
        const prev = lastBySite.get(sid)
        if (!prev || i.executed_at > prev) lastBySite.set(sid, i.executed_at)
      }
    }
  }

  const notesBySite = new Map<string, number>()
  for (const n of (notesRes.data ?? []) as Array<{ site_id: string }>) {
    notesBySite.set(n.site_id, (notesBySite.get(n.site_id) ?? 0) + 1)
  }

  return rows.map((s) => {
    const c = Array.isArray(s.contract) ? s.contract[0] ?? null : s.contract
    const cl = Array.isArray(s.client) ? s.client[0] ?? null : s.client
    return {
      id: s.id,
      client_id: s.client_id,
      contract_id: s.contract_id,
      name: s.name,
      address: s.address,
      notes: s.notes,
      phase: s.phase,
      access_code: s.access_code,
      alarm_code: s.alarm_code,
      contact_name: s.contact_name,
      contact_phone: s.contact_phone,
      access_hours: s.access_hours,
      access_instructions: s.access_instructions,
      created_at: s.created_at,
      deleted_at: s.deleted_at,
      contract_name: c?.name ?? null,
      contract_status: c?.status ?? null,
      client_display_name: cl?.name ?? null,
      last_intervention_at: lastBySite.get(s.id) ?? null,
      missions_count: missionsBySite.get(s.id)?.length ?? 0,
      interventions_count: interventionsBySite.get(s.id) ?? 0,
      site_notes_count: notesBySite.get(s.id) ?? 0,
    }
  })
}

export interface SiteDependencies {
  missionsCount: number
  interventionsCount: number
  siteNotesCount: number
}

/**
 * Compte les dépendances d'un site pour décider si on peut le supprimer.
 * Renvoie 0/0/0 si aucune donnée — alors le delete est autorisé.
 */
export async function getSiteDependencies(siteId: string): Promise<SiteDependencies> {
  const supabase = createAdminClient()
  const [missionsRes, notesRes] = await Promise.all([
    supabase
      .from('missions')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .is('deleted_at', null),
    supabase
      .from('site_notes')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .is('deleted_at', null),
  ])
  if (missionsRes.error) throw missionsRes.error
  if (notesRes.error) throw notesRes.error

  // Interventions : pas de site_id direct, on passe par les missions du site.
  let interventionsCount = 0
  const { data: missionIds, error: mErr } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  if (mErr) throw mErr
  const ids = (missionIds ?? []).map((m) => m.id as string)
  if (ids.length > 0) {
    const { count, error: iErr } = await supabase
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .in('mission_id', ids)
    if (iErr) throw iErr
    interventionsCount = count ?? 0
  }

  return {
    missionsCount: missionsRes.count ?? 0,
    interventionsCount,
    siteNotesCount: notesRes.count ?? 0,
  }
}

/**
 * Soft-delete un site (deleted_at = now()). Idempotent : ne touche pas un
 * site déjà supprimé. C'est au caller de vérifier les dépendances via
 * getSiteDependencies() AVANT d'appeler ceci pour respecter la doctrine
 * « jamais perdre de l'historique ».
 */
export async function softDeleteSite(siteId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('sites')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', siteId)
    .is('deleted_at', null)
  if (error) throw error
}

/** Site inactif = dernière intervention exécutée il y a >6 mois (ou jamais). */
export function isSiteInactive(lastInterventionAt: string | null): boolean {
  if (!lastInterventionAt) return false // sans intervention = nouveau, pas inactif
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6)
  return new Date(lastInterventionAt) < sixMonthsAgo
}

export interface SiteFieldsPatch {
  name?: string
  address?: string | null
  notes?: string | null
  access_code?: string | null
  alarm_code?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  access_hours?: string | null
  access_instructions?: string | null
}

export async function updateSite(id: string, patch: SiteFieldsPatch): Promise<void> {
  const supabase = createAdminClient()
  const update: Record<string, unknown> = {}
  for (const k of [
    'name',
    'address',
    'notes',
    'access_code',
    'alarm_code',
    'contact_name',
    'contact_phone',
    'access_hours',
    'access_instructions',
  ] as const) {
    if (patch[k] !== undefined) update[k] = patch[k]
  }
  if (Object.keys(update).length === 0) return
  const { error } = await supabase
    .from('sites')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw error
}

export async function createSite(input: {
  /** null = chantier sans client (prévisite, repérage, urgence). Assumé, mig 210. */
  client_id: string | null
  contract_id: string | null
  name: string
  address?: string | null
  notes?: string | null
  access_code?: string | null
  alarm_code?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  access_hours?: string | null
  access_instructions?: string | null
  canonical_site_key?: string | null
  /** Phase de vie (mig 171). Par défaut 'actif' = un chantier réel. */
  phase?: SitePhase
}): Promise<string> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const baseFields = {
    client_id: input.client_id,
    contract_id: input.contract_id,
    name: input.name,
    address: input.address ?? null,
    notes: input.notes ?? null,
    access_code: input.access_code ?? null,
    alarm_code: input.alarm_code ?? null,
    contact_name: input.contact_name ?? null,
    contact_phone: input.contact_phone ?? null,
    access_hours: input.access_hours ?? null,
    access_instructions: input.access_instructions ?? null,
    phase: input.phase ?? 'actif',
    ...(orgId ? { organization_id: orgId } : {}),
  }
  const { data, error } = await supabase
    .from('sites')
    .insert({
      ...baseFields,
      ...(input.canonical_site_key != null ? { canonical_site_key: input.canonical_site_key } : {}),
    })
    .select('id')
    .single()

  // Migration 062 pas encore appliquée → retry sans canonical_site_key
  if (error && (error as { code?: string }).code === '42703' && input.canonical_site_key != null) {
    const { data: data2, error: err2 } = await supabase
      .from('sites')
      .insert(baseFields)
      .select('id')
      .single()
    if (err2) throw err2
    return data2.id
  }

  if (error) throw error
  return data.id
}

// =================================
// Lieu partagé — support des dossiers d'opération (mig 172)
//
// L'identité de mémoire est le DOSSIER (lib/db/dossiers.ts), pas le site. Le site
// reste le LIEU : créé/réutilisé, il porte la mémoire permanente (à-savoir, pièges,
// accès) qui s'injecte dans chaque nouveau dossier.
// =================================

/** Trouve (par nom, dans l'org) ou crée un client léger. Pour le donneur d'ordre d'un AO. */
export async function findOrCreateClientByName(name: string): Promise<string> {
  const supabase = createAdminClient()
  const orgId = await getOrgId()
  const trimmed = name.trim()
  let findQ = supabase.from('clients').select('id').ilike('name', trimmed).is('deleted_at', null).limit(1)
  if (orgId) findQ = findQ.eq('organization_id', orgId)
  const { data: existing } = await findQ
  const hit = (existing ?? [])[0] as { id: string } | undefined
  if (hit) return hit.id

  const { data, error } = await supabase
    .from('clients')
    .insert({ name: trimmed, ...(orgId ? { organization_id: orgId } : {}) })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

// =================================
// Mémoire des lieux — Sprint 2 doctrine V5
//
// Notes courtes vivantes par site (140 chars max).
// Format descriptif passif uniquement — verrou V4 (pas de « Pense à... »,
// « Attention à... ») et verrou V5 (édition contrainte, pas un mini-CMS).
// =================================

const DEFAULT_NOTE_LIMIT = 10

/**
 * Liste les notes actives (non-soft-deleted) d'un site, triées par date desc.
 * Limite par défaut : 10. La page mobile affiche 3-5.
 */
export async function listSiteNotes(siteId: string, limit?: number): Promise<DbSiteNote[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_notes')
    .select('*')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, limit ?? DEFAULT_NOTE_LIMIT))
  if (error) throw error
  return (data ?? []) as DbSiteNote[]
}

/**
 * Crée une note courte sur un site. Body trimé puis validé 3-140 chars.
 * `created_by` est récupéré du contexte auth — sans user → throws (la policy
 * INSERT exige created_by = auth.uid()).
 *
 * Phase 3.1 (migration 045) : ajout de kind (note|a_savoir) et active_until.
 * active_until ne peut être posé que sur kind='a_savoir' (contrainte DB).
 *
 * Doctrine V5 : édition contrainte. Pas de wording managérial côté UI ; la
 * validation backend reste neutre (contrainte de longueur uniquement, pas de
 * lexique imposé sur le contenu — le système ne juge pas les mots de l'humain).
 */
export async function createSiteNote(input: {
  siteId: string
  body: string
  kind?: 'note' | 'a_savoir'
  activeUntil?: string | null
}): Promise<DbSiteNote> {
  const trimmed = input.body.trim()
  if (trimmed.length < 3) {
    throw new Error('Note trop courte (3 caractères minimum)')
  }
  if (trimmed.length > 140) {
    throw new Error('Note trop longue (140 caractères maximum)')
  }
  const kind = input.kind ?? 'note'
  if (kind === 'note' && input.activeUntil) {
    throw new Error('active_until ne s\'applique qu\'aux À savoir')
  }

  // Récupère l'utilisateur authentifié pour created_by (cohérent avec la RLS).
  const server = await createServerClient()
  const { data: { user } } = await server.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Admin client pour l'insert (bypass RLS — l'auth a déjà été vérifiée).
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('site_notes')
    .insert({
      site_id: input.siteId,
      body: trimmed,
      kind,
      active_until: kind === 'a_savoir' ? (input.activeUntil ?? null) : null,
      created_by: user.id,
    })
    .select('*')
    .single()
  if (error) throw error

  // Fire-and-forget embedding — silencieux si pas de clé API configurée.
  if (trimmed.length >= 8) {
    const noteId = (data as DbSiteNote).id
    const siteId = input.siteId
    import('@/lib/ai/embed-trace').then(({ embedAndStoreTrace }) =>
      embedAndStoreTrace({ sourceType: 'site_note', sourceId: noteId, siteId, text: trimmed })
    ).catch(() => {})
  }

  return data as DbSiteNote
}

/**
 * Liste les « À savoir » actifs (kind='a_savoir', non expirés, non supprimés)
 * d'un site. Affichés en bannière sur la fiche site et au démarrage d'une
 * intervention. Pas de tracking de lecture, pas d'acquittement.
 */
export async function listSiteASavoirActive(siteId: string): Promise<DbSiteNote[]> {
  const supabase = createAdminClient()
  const today = todayLocalIso()
  const { data, error } = await supabase
    .from('site_notes')
    .select('*')
    .eq('site_id', siteId)
    .eq('kind', 'a_savoir')
    .is('deleted_at', null)
    .or(`active_until.is.null,active_until.gte.${today}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DbSiteNote[]
}

/**
 * Soft-delete d'une note (deleted_at = now()). N'affecte que les notes encore
 * actives — un nouveau call sur une note déjà supprimée est idempotent.
 */
export async function softDeleteSiteNote(noteId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('site_notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', noteId)
    .is('deleted_at', null)
  if (error) throw error
}
