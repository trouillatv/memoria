import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import type { DbSite, DbSiteNote } from '@/types/db'

export async function listSites(): Promise<DbSite[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .is('deleted_at', null)
    .order('name')
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

  const { data: sites, error } = await supabase
    .from('sites')
    .select('*, contract:contracts(name, status), client:clients(name)')
    .is('deleted_at', null)
    .order('name')
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
  let interventionsBySite = new Map<string, number>()
  let lastBySite = new Map<string, string>()
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
  client_id: string
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
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sites')
    .insert({
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
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
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
  return data as DbSiteNote
}

/**
 * Liste les « À savoir » actifs (kind='a_savoir', non expirés, non supprimés)
 * d'un site. Affichés en bannière sur la fiche site et au démarrage d'une
 * intervention. Pas de tracking de lecture, pas d'acquittement.
 */
export async function listSiteASavoirActive(siteId: string): Promise<DbSiteNote[]> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
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
