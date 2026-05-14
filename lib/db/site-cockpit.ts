// V5.1.3 — Cockpit page Site (cerveau perceptif du produit).
//
// Doctrine Vincent 2026-05-14 : la page Site est l'élément fondateur de l'app.
// Pas un dashboard, pas une fiche technique, pas une timeline — une **lecture
// progressive du lieu**.
//
// Sections :
//   1. IDENTITÉ (historique)
//   2. ÉTAT ACTUEL (4 chiffres descriptifs sobres)
//   3. ACTIVITÉ RÉCENTE (colonne respirante)
//   4. ANOMALIES / CICATRICES (bordure persistante)
//   5. CONTINUITÉ HUMAINE (succession, pas ranking)
//   6. MÉMOIRE DU LIEU (substrat fading — existant)
//
// Garde-fous doctrinaux :
//   - Chiffres : SITE-CENTRIC uniquement (jamais par agent)
//   - Mentions humaines : descriptives événementielles, jamais cliquables, jamais classements
//   - Pas de %, pas de scores, pas de KPI agent, pas de comparaisons inter-sites
//   - Pas de cards colorées, pas de donuts — typographie + blanc + hiérarchie + silence

import { createAdminClient } from '@/lib/supabase/admin'

// =============================================================================
// Types
// =============================================================================

export interface SiteIdentity {
  id: string
  name: string
  address: string | null
  contractId: string | null
  contractName: string | null
  clientName: string | null
  contractStartedAt: string | null  // ISO — pour "Contrat depuis octobre 2023"
  teamsSucceeded: number  // nombre d'équipes distinctes ayant été affectées
}

export interface SiteCurrentState {
  passagesThisMonth: number
  openAnomalies: number
  lastPassageAt: string | null
  lastPassageActor: string | null  // prénom (descriptif, jamais cliquable)
  lastPassagePhotoCount: number
  nextScheduledAt: string | null
  nextScheduledSlot: 'morning' | 'afternoon' | 'evening' | null
}

export interface RecentActivityItem {
  kind: 'photo' | 'anomaly' | 'site_note' | 'intervention'
  id: string
  occurredAt: string
  primary: string  // "Joseph est passé ce matin." / "Plomberie bloc B."
  secondary: string | null  // "3 photos déposées." / "anomalie ouverte mardi."
  saliencePrimary: boolean  // pour le rendu visuel (● vs ·)
}

export interface SiteAnomalyEntry {
  id: string
  description: string
  status: 'open' | 'resolved' | 'ignored'
  createdAt: string
  resolvedAt: string | null
  ageDays: number  // pour la cicatrice fading
}

export interface HumanContinuityEntry {
  firstName: string
  firstSeenAt: string  // ISO — première trace sur ce site
  lastSeenAt: string  // ISO — dernière trace
  spanMonths: number
  isCurrent: boolean  // true si membre actif d'une team du site aujourd'hui
}

export interface HumanContinuity {
  predecessors: HumanContinuityEntry[]  // tri desc par spanMonths
  totalChiefs: number
  teamsSucceeded: number
}

// =============================================================================
// Helpers internes
// =============================================================================

function firstNameOf(fullName: string | null, email: string): string {
  const trimmed = (fullName ?? '').trim()
  if (trimmed.length > 0) {
    const first = trimmed.split(/\s+/)[0]
    if (first) return first
  }
  const local = (email.split('@')[0] ?? email).trim()
  if (local.length === 0) return ''
  return local[0].toUpperCase() + local.slice(1)
}

function monthsBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const years = end.getUTCFullYear() - start.getUTCFullYear()
  const months = end.getUTCMonth() - start.getUTCMonth()
  return Math.max(0, years * 12 + months)
}

// =============================================================================
// SECTION 1 — IDENTITÉ
// =============================================================================

export async function getSiteIdentity(siteId: string): Promise<SiteIdentity | null> {
  const supabase = createAdminClient()

  const { data: site } = await supabase
    .from('sites')
    .select('id, name, address, contract_id, created_at')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) return null

  let contractName: string | null = null
  let clientName: string | null = null
  let contractStartedAt: string | null = null
  if (site.contract_id) {
    const { data: contract } = await supabase
      .from('contracts')
      .select('name, client_name, start_date, created_at')
      .eq('id', site.contract_id)
      .maybeSingle()
    if (contract) {
      contractName = contract.name as string | null
      clientName = contract.client_name as string | null
      // start_date peut ne pas exister selon schéma — fallback created_at
      contractStartedAt = (contract.start_date as string | null) ?? (contract.created_at as string | null)
    }
  }

  // Nombre d'équipes distinctes ayant été affectées (via missions du site → interventions)
  // Site-centric, pas user-centric : on compte des conteneurs logistiques (teams), pas des personnes.
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)

  let teamsSucceeded = 0
  if (missionIds.length > 0) {
    const { data: interventions } = await supabase
      .from('interventions')
      .select('assigned_team_id')
      .in('mission_id', missionIds)
      .not('assigned_team_id', 'is', null)
    const distinctTeams = new Set(
      (interventions ?? [])
        .map((i) => (i as { assigned_team_id: string | null }).assigned_team_id)
        .filter((id): id is string => !!id),
    )
    teamsSucceeded = distinctTeams.size
  }

  return {
    id: site.id as string,
    name: site.name as string,
    address: (site.address as string | null) ?? null,
    contractId: (site.contract_id as string | null) ?? null,
    contractName,
    clientName,
    contractStartedAt,
    teamsSucceeded,
  }
}

// =============================================================================
// SECTION 2 — ÉTAT ACTUEL
// =============================================================================

export async function getSiteCurrentState(siteId: string): Promise<SiteCurrentState> {
  const supabase = createAdminClient()

  // Récupérer mission_ids du site
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)

  if (missionIds.length === 0) {
    return {
      passagesThisMonth: 0,
      openAnomalies: 0,
      lastPassageAt: null,
      lastPassageActor: null,
      lastPassagePhotoCount: 0,
      nextScheduledAt: null,
      nextScheduledSlot: null,
    }
  }

  // Mois courant
  const now = new Date()
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`

  // Passages ce mois : count interventions executed_at >= monthStart
  const { count: passagesThisMonth } = await supabase
    .from('interventions')
    .select('id', { count: 'exact', head: true })
    .in('mission_id', missionIds)
    .gte('executed_at', monthStart)

  // Anomalies ouvertes
  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
  const interventionIds = (interventionsAll ?? []).map((i) => i.id)

  let openAnomalies = 0
  if (interventionIds.length > 0) {
    const { count } = await supabase
      .from('intervention_anomalies')
      .select('id', { count: 'exact', head: true })
      .in('intervention_id', interventionIds)
      .eq('status', 'open')
    openAnomalies = count ?? 0
  }

  // Dernier passage : intervention completed/validated la plus récente
  let lastPassageAt: string | null = null
  let lastPassageActor: string | null = null
  let lastPassagePhotoCount = 0
  if (interventionIds.length > 0) {
    const { data: lastIntv } = await supabase
      .from('interventions')
      .select('id, executed_at, scheduled_at, status, team')
      .in('mission_id', missionIds)
      .in('status', ['completed', 'validated'])
      .order('executed_at', { ascending: false, nullsFirst: false })
      .limit(1)
    const intv = lastIntv?.[0] as
      | { id: string; executed_at: string | null; scheduled_at: string; team: string[] | null }
      | undefined

    if (intv) {
      lastPassageAt = intv.executed_at ?? intv.scheduled_at

      // Photo count + dernier auteur photo (descriptif événementiel, jamais "fiche personne")
      const { data: photos } = await supabase
        .from('intervention_photos')
        .select('id, taken_by, taken_at')
        .eq('intervention_id', intv.id)
        .order('taken_at', { ascending: false })
      lastPassagePhotoCount = (photos ?? []).length

      const lastTakenBy = (photos as Array<{ taken_by: string | null }> | null)?.[0]?.taken_by ?? null
      if (lastTakenBy) {
        const { data: user } = await supabase
          .from('users')
          .select('full_name, email')
          .eq('id', lastTakenBy)
          .maybeSingle()
        if (user) {
          lastPassageActor = firstNameOf(user.full_name as string | null, user.email as string)
        }
      }
    }
  }

  // Prochain passage prévu
  const { data: nextIntv } = await supabase
    .from('interventions')
    .select('scheduled_at, slot')
    .in('mission_id', missionIds)
    .in('status', ['planned'])
    .gte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(1)
  const next = nextIntv?.[0] as { scheduled_at: string; slot: string | null } | undefined

  return {
    passagesThisMonth: passagesThisMonth ?? 0,
    openAnomalies,
    lastPassageAt,
    lastPassageActor,
    lastPassagePhotoCount,
    nextScheduledAt: next?.scheduled_at ?? null,
    nextScheduledSlot: (next?.slot as SiteCurrentState['nextScheduledSlot']) ?? null,
  }
}

// =============================================================================
// SECTION 3 — ACTIVITÉ RÉCENTE
// =============================================================================

export async function getSiteRecentActivity(
  siteId: string,
  limit = 10,
): Promise<RecentActivityItem[]> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) return []

  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
  const interventionIds = (interventionsAll ?? []).map((i) => i.id)
  if (interventionIds.length === 0) return []

  // 3 sources :
  //   - intervention_photos (passages = un actor + N photos)
  //   - intervention_anomalies (anomalies ouvertes / résolues)
  //   - site_notes (notes courtes du site)

  const [photosRes, anomaliesRes, notesRes] = await Promise.all([
    supabase
      .from('intervention_photos')
      .select('id, intervention_id, taken_at, taken_by, kind')
      .in('intervention_id', interventionIds)
      .order('taken_at', { ascending: false })
      .limit(30),
    supabase
      .from('intervention_anomalies')
      .select('id, intervention_id, description, category, category_other, status, created_at, resolved_at')
      .in('intervention_id', interventionIds)
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('site_notes')
      .select('id, body, created_by, created_at')
      .eq('site_id', siteId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  // Agréger les photos par (intervention_id, day, taken_by) pour faire des "passages"
  type PhotoRow = { id: string; intervention_id: string; taken_at: string; taken_by: string | null; kind: string }
  const photoGroups = new Map<string, { count: number; first: PhotoRow; takenBy: string | null }>()
  for (const p of (photosRes.data ?? []) as PhotoRow[]) {
    const day = p.taken_at.slice(0, 10)
    const key = `${p.intervention_id}|${day}|${p.taken_by ?? 'anon'}`
    const existing = photoGroups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      photoGroups.set(key, { count: 1, first: p, takenBy: p.taken_by })
    }
  }

  // Résoudre les prénoms des auteurs photos en batch
  const photoActorIds = Array.from(new Set(Array.from(photoGroups.values()).map((g) => g.takenBy).filter((id): id is string => !!id)))
  const noteActorIds = Array.from(new Set(((notesRes.data ?? []) as Array<{ created_by: string | null }>).map((n) => n.created_by).filter((id): id is string => !!id)))
  const allActorIds = Array.from(new Set([...photoActorIds, ...noteActorIds]))
  const firstNameById = new Map<string, string>()
  if (allActorIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, email')
      .in('id', allActorIds)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
      firstNameById.set(u.id, firstNameOf(u.full_name, u.email))
    }
  }

  const items: RecentActivityItem[] = []

  // Passages (groupes de photos)
  for (const g of photoGroups.values()) {
    const actorName = g.takenBy ? firstNameById.get(g.takenBy) ?? 'Quelqu’un' : 'Quelqu’un'
    items.push({
      kind: 'photo',
      id: g.first.id,
      occurredAt: g.first.taken_at,
      primary: `${actorName} est passé.`,
      secondary: `${g.count} photo${g.count > 1 ? 's' : ''} déposée${g.count > 1 ? 's' : ''}.`,
      saliencePrimary: true,
    })
  }

  // Anomalies
  type AnomRow = {
    id: string
    description: string | null
    category: string
    category_other: string | null
    status: string
    created_at: string
    resolved_at: string | null
  }
  for (const a of (anomaliesRes.data ?? []) as AnomRow[]) {
    const title = a.description || a.category_other || a.category
    const isOpen = a.status === 'open'
    items.push({
      kind: 'anomaly',
      id: a.id,
      occurredAt: a.resolved_at ?? a.created_at,
      primary: title.charAt(0).toUpperCase() + title.slice(1),
      secondary: isOpen ? `anomalie ouverte.` : `résolue.`,
      saliencePrimary: isOpen,
    })
  }

  // Site notes
  type NoteRow = { id: string; body: string; created_by: string | null; created_at: string }
  for (const n of (notesRes.data ?? []) as NoteRow[]) {
    const actor = n.created_by ? firstNameById.get(n.created_by) ?? null : null
    items.push({
      kind: 'site_note',
      id: n.id,
      occurredAt: n.created_at,
      primary: n.body,
      secondary: actor ? `noté par ${actor}.` : null,
      saliencePrimary: false,
    })
  }

  // Tri global DESC + cap au limit
  items.sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : b.occurredAt < a.occurredAt ? -1 : 0))
  return items.slice(0, limit)
}

// =============================================================================
// SECTION 4 — ANOMALIES / CICATRICES
// =============================================================================

export async function getSiteAnomalies(siteId: string): Promise<SiteAnomalyEntry[]> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) return []

  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
  const interventionIds = (interventionsAll ?? []).map((i) => i.id)
  if (interventionIds.length === 0) return []

  const { data: anomalies } = await supabase
    .from('intervention_anomalies')
    .select('id, description, category, category_other, status, created_at, resolved_at')
    .in('intervention_id', interventionIds)
    .order('created_at', { ascending: false })
    .limit(20)

  const now = Date.now()
  return ((anomalies ?? []) as Array<{
    id: string
    description: string | null
    category: string
    category_other: string | null
    status: string
    created_at: string
    resolved_at: string | null
  }>).map((a) => {
    const refTime = new Date(a.resolved_at ?? a.created_at).getTime()
    const ageDays = Math.max(0, Math.floor((now - refTime) / 86_400_000))
    return {
      id: a.id,
      description: a.description || a.category_other || a.category,
      status: (a.status as SiteAnomalyEntry['status']),
      createdAt: a.created_at,
      resolvedAt: a.resolved_at,
      ageDays,
    }
  })
}

// =============================================================================
// SECTION 5 — CONTINUITÉ HUMAINE
// =============================================================================

export async function getSiteHumanContinuity(siteId: string): Promise<HumanContinuity> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) {
    return { predecessors: [], totalChiefs: 0, teamsSucceeded: 0 }
  }

  // Récupère tous les passages photos de ce site, groupés par taken_by
  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id, assigned_team_id')
    .in('mission_id', missionIds)
  const interventionRows = (interventionsAll ?? []) as Array<{
    id: string
    assigned_team_id: string | null
  }>
  const interventionIds = interventionRows.map((i) => i.id)
  const teamIds = new Set(interventionRows.map((i) => i.assigned_team_id).filter((t): t is string => !!t))

  if (interventionIds.length === 0) {
    return { predecessors: [], totalChiefs: 0, teamsSucceeded: teamIds.size }
  }

  const { data: photos } = await supabase
    .from('intervention_photos')
    .select('taken_by, taken_at')
    .in('intervention_id', interventionIds)
    .not('taken_by', 'is', null)
    .order('taken_at', { ascending: true })

  // Group par taken_by, get firstSeen + lastSeen
  type Range = { firstSeen: string; lastSeen: string }
  const byUser = new Map<string, Range>()
  for (const p of (photos ?? []) as Array<{ taken_by: string; taken_at: string }>) {
    const existing = byUser.get(p.taken_by)
    if (!existing) {
      byUser.set(p.taken_by, { firstSeen: p.taken_at, lastSeen: p.taken_at })
    } else {
      if (p.taken_at < existing.firstSeen) existing.firstSeen = p.taken_at
      if (p.taken_at > existing.lastSeen) existing.lastSeen = p.taken_at
    }
  }

  if (byUser.size === 0) {
    return { predecessors: [], totalChiefs: 0, teamsSucceeded: teamIds.size }
  }

  // Résoudre identités + détecter qui est "current" (membre actif d'une team du site)
  const userIds = Array.from(byUser.keys())
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .in('id', userIds)

  // Memberships actifs sur les teams du site
  let activeUserIds = new Set<string>()
  if (teamIds.size > 0) {
    const { data: memberships } = await supabase
      .from('team_members')
      .select('user_id')
      .in('team_id', Array.from(teamIds))
      .is('left_at', null)
    activeUserIds = new Set(
      (memberships ?? []).map((m) => (m as { user_id: string }).user_id),
    )
  }

  const predecessors: HumanContinuityEntry[] = []
  for (const u of (users ?? []) as Array<{
    id: string
    full_name: string | null
    email: string
    role: string
  }>) {
    // On filtre sur les chef_equipe (le concept "tenir un site" est porté par les agents terrain)
    if (u.role !== 'chef_equipe') continue
    const range = byUser.get(u.id)
    if (!range) continue
    const spanMonths = monthsBetween(range.firstSeen, range.lastSeen)
    predecessors.push({
      firstName: firstNameOf(u.full_name, u.email),
      firstSeenAt: range.firstSeen,
      lastSeenAt: range.lastSeen,
      spanMonths,
      isCurrent: activeUserIds.has(u.id),
    })
  }

  // Tri : current d'abord, puis par spanMonths desc
  predecessors.sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1
    if (!a.isCurrent && b.isCurrent) return 1
    return b.spanMonths - a.spanMonths
  })

  return {
    predecessors,
    totalChiefs: predecessors.length,
    teamsSucceeded: teamIds.size,
  }
}

// =============================================================================
// SECTION 6 — CE QUI REVIENT (motifs faibles)
// =============================================================================

// Stopwords FR minimaliste — extension de lib/ai/memory-resonances.ts mais
// local pour éviter dépendance cross-feature. Si on factorise plus tard, OK.
const STOPWORDS_FR_SITE = new Set([
  'avec', 'pour', 'dans', 'depuis', 'mais', 'donc', 'cette', 'celle', 'celui',
  'sont', 'sera', 'etre', 'avoir', 'aussi', 'leur', 'leurs', 'plus', 'moins',
  'tres', 'bien', 'tout', 'tous', 'toute', 'toutes', 'sans', 'sous', 'apres',
  'avant', 'pendant', 'comme', 'meme', 'autre', 'autres', 'fait', 'faire',
  'voir', 'site', 'sites', 'note', 'notes', 'jour', 'jours', 'mois', 'annee',
  'matin', 'soir', 'oui', 'non', 'peut', 'doit', 'doivent', 'pris', 'mise',
  'cas', 'lieu', 'lieux', 'quelque', 'quelques', 'aujourd', 'hier', 'donc',
  'cela', 'rien', 'puis', 'fois', 'sortir', 'mettre', 'avoir', 'parce',
  'celui', 'soit', 'ainsi', 'alors', 'avant', 'chaque', 'leurs', 'parle',
])

export interface WhatReturnsHere {
  /** Mots/termes récurrents du site (>=3 occurrences, ordre alphabétique). */
  words: string[]
}

function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function tokenizeSite(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length >= 4 && !STOPWORDS_FR_SITE.has(w))
}

/**
 * Section 6 — Ce qui revient.
 *
 * Doctrine Vincent 2026-05-14 : extraction de motifs faibles humains.
 * Pas d'interprétation, pas de synthèse, pas de conclusion. Juste :
 * "ces mots reviennent souvent ici". Liste alphabétique pour éviter
 * la sensation de ranking.
 *
 * Implémentation V1 : comptage côté JS sur corpus du site (anomalies +
 * site_notes + intervention notes) — acceptable pour pilote (< 500
 * entrées texte par site). À refactorer en RPC SQL ts_stat pour scale.
 */
export async function getSiteWhatReturns(siteId: string): Promise<WhatReturnsHere> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) return { words: [] }

  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id, notes')
    .in('mission_id', missionIds)
  const interventionRows = (interventionsAll ?? []) as Array<{ id: string; notes: string | null }>
  const interventionIds = interventionRows.map((i) => i.id)

  const corpus: string[] = []

  // intervention.notes
  for (const i of interventionRows) {
    if (i.notes && i.notes.trim().length > 0) corpus.push(i.notes)
  }

  if (interventionIds.length > 0) {
    const { data: anomalies } = await supabase
      .from('intervention_anomalies')
      .select('description, category_other')
      .in('intervention_id', interventionIds)
    for (const a of (anomalies ?? []) as Array<{
      description: string | null
      category_other: string | null
    }>) {
      if (a.description) corpus.push(a.description)
      if (a.category_other) corpus.push(a.category_other)
    }
  }

  const { data: siteNotes } = await supabase
    .from('site_notes')
    .select('body')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  for (const n of (siteNotes ?? []) as Array<{ body: string }>) {
    if (n.body) corpus.push(n.body)
  }

  if (corpus.length === 0) return { words: [] }

  // Compte des mots
  const counts = new Map<string, number>()
  for (const text of corpus) {
    const seen = new Set<string>()
    for (const w of tokenizeSite(text)) {
      if (seen.has(w)) continue
      seen.add(w)
      counts.set(w, (counts.get(w) ?? 0) + 1)
    }
  }

  // Top mots avec >= 3 occurrences, max 7, ordre alphabétique
  const RETURNS_MIN_COUNT = 3
  const MAX_WORDS = 7
  const candidates = Array.from(counts.entries())
    .filter(([, count]) => count >= RETURNS_MIN_COUNT)
    .sort((a, b) => b[1] - a[1]) // tri desc par fréquence pour top N
    .slice(0, MAX_WORDS)
    .map(([w]) => w)
    .sort() // puis alphabétique pour éviter ranking visuel

  return { words: candidates }
}
