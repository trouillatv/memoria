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
import {
  getSignedPhotoUrlsNarrow,
  getSignedPhotoUrlsMedium,
  getSignedPhotoUrlsThumb,
} from '@/lib/storage/intervention-photos'

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
  primary: string  // "Joseph a documenté le bloc pédiatrie." / "Plomberie bloc B."
  secondary: string | null  // "3 traces déposées." / "anomalie ouverte mardi."
  saliencePrimary: boolean  // pour le rendu visuel (● vs ·)
  // V5.1.3 — Vignette unique du passage si applicable. URL signée, aspect natif
  // préservé (jamais crop). Doctrine "trace ponctuelle, pas galerie".
  photoUrl: string | null
  interventionId: string | null  // pour lien vers contexte source
}

export interface SiteAnomalyEntry {
  id: string
  description: string
  status: 'open' | 'resolved' | 'ignored'
  createdAt: string
  resolvedAt: string | null
  ageDays: number  // pour la cicatrice fading
  // V5.1.3 — Photo "cicatrice visible" de l'anomalie. Une seule photo
  // (la plus récente kind='anomaly_evidence'). null si l'anomalie n'a
  // pas été photographiée — l'absence est elle-même une trace (urgence,
  // oubli, fatigue, intervention rapide).
  photoUrl: string | null
  interventionId: string  // pour lien vers contexte source
}

// V5.1.4 — Méta du lieu pour le wording lieu-centric (Vincent 2026-05-15).
// Permet aux empty states de parler de la mémoire du lieu plutôt que de l'absence
// brute. "5 traces déposées depuis février 2026" plutôt que "Aucun événement."
export interface SiteMemoryMeta {
  firstTraceAt: string | null  // ISO de la première trace (photo/anomalie/note)
  totalTraces: number
  /** Dernière anomalie cicatrisée (descriptive pour empty state Anomalies). */
  lastHealed: {
    description: string
    resolvedAt: string
  } | null
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

// V5.1.4 — Rythme du lieu : densité de traces par jour sur N jours glissants.
// Doctrine Vincent 2026-05-15 : "perception structurée, pas KPI". On compte
// les "traces" (intervention exécutée + photo + anomalie créée + note) par
// jour, et on rend visuellement la densité — pas pour mesurer la performance
// humaine mais pour FAIRE SENTIR la pulsation du lieu.
export interface SiteRhythmDay {
  date: string  // ISO YYYY-MM-DD
  weekdayLabel: string  // "lun."
  dayMonthLabel: string  // "5"
  isToday: boolean
  isWeekend: boolean
  count: number
}

// V5.1.4 — Présences humaines récentes : prénoms uniques des personnes qui
// ont laissé une trace sur ce site dans la fenêtre. Ordre alphabétique
// strict — pas de ranking, pas de comptage par personne (verrou V3
// anti-reverse-lookup). C'est de la mémoire de présence, pas de la mesure
// d'activité.
export interface HumanPresences {
  /** Prénoms uniques, ordre alphabétique. */
  firstNames: string[]
  /** Fenêtre temporelle en jours. */
  periodDays: number
}

// V5.1.4 — Présences d'ÉQUIPES (Vincent 2026-05-15 : "L'équipe = continuité
// collective, pas surveillance individuelle"). Swap doctrinal majeur :
// l'équipe est un container logistique, pas une personne — pas de fiche
// profil possible, pas de reverse-lookup. C'est la mémoire organisationnelle.
export interface TeamPresences {
  /** Noms d'équipes uniques, ordre alphabétique (anti-leaderboard). */
  teamNames: string[]
  /** Fenêtre temporelle en jours. */
  periodDays: number
}

// V5.1.4 — Couche 3 IA perceptive (Vincent 2026-05-15) : "L'IA est un
// révélateur du réel, pas un générateur de texte." Phrases factuelles
// extraites algorithmiquement de patterns faibles. Pas de LLM ici — uniquement
// assemblage de constats observés (verrou Pilier 4 : DG reste auteur).
export interface SiteReading {
  /** Type de motif détecté (pour debug / future déclinaison UI). */
  kind:
    | 'recurring_place'
    | 'resolved_not_returned'
    | 'absent_pattern'
    | 'resonance_note_anomaly'  // Type A — consigne ↔ anomalie
    | 'persistence_place'        // Persistance d'un lieu malgré N interventions
    | 'transmission'             // IA de continuité — bribes du prédécesseur
  /** Phrase factuelle prête à afficher (déjà ponctuée). */
  text: string
  /**
   * Axe doctrinal V5.1.4 (Vincent 2026-05-15) pour groupement visuel UI.
   * RÉSONANCES / PERSISTANCES / ABSENCES / TRANSMISSIONS.
   */
  axis: 'resonance' | 'persistence' | 'absence' | 'transmission'
  /**
   * Fragments lexicaux à afficher en liste verticale sous `text`.
   * Vincent 2026-05-15 : "L'IA ne raconte pas, elle expose le tissu. Le cerveau
   * humain fait lui-même les liens." Utilisé surtout pour transmission —
   * `text` devient une amorce d'une ligne ("Avant la reprise par Moana :"),
   * `fragments` une liste pure de mots-clés/lieux extraits.
   */
  fragments?: string[]
}

export interface SiteReadings {
  /** 0 à 6 lectures, ordre de saillance puis chronologique. */
  readings: SiteReading[]
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

// V5.1.4 — Extraction de lieu pour wording lieu-centric (Vincent 2026-05-15).
// "Anaïs a documenté le bloc pédiatrie" plutôt que "Anaïs est passée".
// Le lieu = premier syntagme "tête + qualifieur" détecté dans un texte
// (caption photo, description anomalie, note). Si rien détecté, null →
// le composant UI fait fallback générique.
const PLACE_REGEX_GLOBAL = /\b(bloc|couloir|salle|réserve|reserve|entrée|entree|sortie|étage|etage|niveau|hall|local|zone|sanitaire|sanitaires|vestiaire|vestiaires|cuisine|bureau|bureaux|chambre|chambres|pédiatrie|pediatrie|maternité|maternite|urgences)\s+([A-Za-zÀ-ÿ0-9]+)/i

function extractFirstPlace(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    if (!t) continue
    const m = PLACE_REGEX_GLOBAL.exec(t)
    if (m) return `${m[1].toLowerCase()} ${m[2].toLowerCase()}`
  }
  return null
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
      .select('id, intervention_id, taken_at, taken_by, kind, storage_path, caption')
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

  // Agréger les photos par (intervention_id, day, taken_by) pour faire des "passages".
  // V5.1.4 — On collecte aussi les captions pour pouvoir extraire un lieu et
  // construire une phrase lieu-centric ("a documenté le bloc pédiatrie").
  type PhotoRow = {
    id: string
    intervention_id: string
    taken_at: string
    taken_by: string | null
    kind: string
    storage_path: string
    caption: string | null
  }
  const photoGroups = new Map<
    string,
    { count: number; first: PhotoRow; takenBy: string | null; captions: string[] }
  >()
  for (const p of (photosRes.data ?? []) as PhotoRow[]) {
    const day = p.taken_at.slice(0, 10)
    const key = `${p.intervention_id}|${day}|${p.taken_by ?? 'anon'}`
    const existing = photoGroups.get(key)
    if (existing) {
      existing.count += 1
      if (p.caption) existing.captions.push(p.caption)
    } else {
      photoGroups.set(key, {
        count: 1,
        first: p,
        takenBy: p.taken_by,
        captions: p.caption ? [p.caption] : [],
      })
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

  // V5.1.4 — Wording lieu-centric (Vincent 2026-05-15).
  // Si on extrait un lieu de la caption → "X a documenté le bloc pédiatrie."
  // Sinon → "X a déposé N traces." (le sujet reste l'action sur le lieu, pas le système)
  for (const g of photoGroups.values()) {
    const actorName = g.takenBy ? firstNameById.get(g.takenBy) ?? 'Quelqu’un' : 'Quelqu’un'
    const place = extractFirstPlace(...g.captions)
    const countLabel = `${g.count} trace${g.count > 1 ? 's' : ''}`

    const firstCaption = g.captions[0] ?? null
    let primary: string
    let secondary: string | null
    if (firstCaption) {
      const cap = firstCaption.length > 90 ? firstCaption.slice(0, 87) + '…' : firstCaption
      primary = cap
      secondary = actorName + (g.count > 1 ? ` · ${countLabel}` : '')
    } else if (place) {
      primary = `${actorName} — ${place}.`
      secondary = g.count > 1 ? countLabel : null
    } else {
      primary = `${actorName} — ${countLabel}`
      secondary = null
    }

    items.push({
      kind: 'photo',
      id: g.first.id,
      occurredAt: g.first.taken_at,
      primary,
      secondary,
      saliencePrimary: true,
      photoUrl: null, // signée plus bas en batch
      interventionId: g.first.intervention_id,
    })
  }

  // Anomalies
  type AnomRow = {
    id: string
    intervention_id: string
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
      photoUrl: null,
      interventionId: a.intervention_id,
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
      photoUrl: null,
      interventionId: null,
    })
  }

  // Tri global DESC + cap au limit
  items.sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : b.occurredAt < a.occurredAt ? -1 : 0))
  const top = items.slice(0, limit)

  // V5.1.3 — Sign photo URLs only for items kind='photo' (1 vignette par
  // bloc d'activité, doctrine Vincent : "trace ponctuelle, pas galerie").
  const photoStorageByItemId = new Map<string, string>()
  for (const item of top) {
    if (item.kind !== 'photo') continue
    const group = Array.from(photoGroups.values()).find((g) => g.first.id === item.id)
    if (group?.first.storage_path) {
      photoStorageByItemId.set(item.id, group.first.storage_path)
    }
  }
  if (photoStorageByItemId.size > 0) {
    const urlMap = await getSignedPhotoUrlsNarrow(Array.from(photoStorageByItemId.values()))
    for (const item of top) {
      const path = photoStorageByItemId.get(item.id)
      if (path) item.photoUrl = urlMap.get(path) ?? null
    }
  }

  return top
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
    .select('id, intervention_id, description, category, category_other, status, created_at, resolved_at')
    .in('intervention_id', interventionIds)
    .order('created_at', { ascending: false })
    .limit(20)

  const anomalyRows = (anomalies ?? []) as Array<{
    id: string
    intervention_id: string
    description: string | null
    category: string
    category_other: string | null
    status: string
    created_at: string
    resolved_at: string | null
  }>

  // V5.1.3 — Photo "cicatrice" pour chaque anomalie. On prend la photo
  // kind='anomaly_evidence' la plus récente de la même intervention. Une seule
  // par anomalie (doctrine Vincent : "pas de galerie, pas de carousel").
  // Une anomalie sans photo affiche du texte seul — l'absence est une trace.
  const anomalyInterventionIds = Array.from(new Set(anomalyRows.map((a) => a.intervention_id)))
  const storagePathByIntervention = new Map<string, string>()
  if (anomalyInterventionIds.length > 0) {
    const { data: evidencePhotos } = await supabase
      .from('intervention_photos')
      .select('intervention_id, storage_path, taken_at')
      .in('intervention_id', anomalyInterventionIds)
      .eq('kind', 'anomaly_evidence')
      .order('taken_at', { ascending: false })
    for (const p of (evidencePhotos ?? []) as Array<{
      intervention_id: string
      storage_path: string
      taken_at: string
    }>) {
      if (!storagePathByIntervention.has(p.intervention_id)) {
        storagePathByIntervention.set(p.intervention_id, p.storage_path)
      }
    }
  }
  const urlMap = storagePathByIntervention.size > 0
    ? await getSignedPhotoUrlsMedium(Array.from(storagePathByIntervention.values()))
    : new Map<string, string>()

  const now = Date.now()
  return anomalyRows.map((a) => {
    const refTime = new Date(a.resolved_at ?? a.created_at).getTime()
    const ageDays = Math.max(0, Math.floor((now - refTime) / 86_400_000))
    const path = storagePathByIntervention.get(a.intervention_id)
    return {
      id: a.id,
      description: a.description || a.category_other || a.category,
      status: (a.status as SiteAnomalyEntry['status']),
      createdAt: a.created_at,
      resolvedAt: a.resolved_at,
      ageDays,
      photoUrl: path ? urlMap.get(path) ?? null : null,
      interventionId: a.intervention_id,
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

// =============================================================================
// SECTION 7 — RYTHME DU LIEU (densité de traces par jour)
// =============================================================================

const FR_WEEKDAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

/**
 * Rythme du lieu — densité de traces par jour sur une fenêtre glissante.
 *
 * Doctrine Vincent 2026-05-15 :
 *   "perception structurée, pas KPI. On fait SENTIR la pulsation du lieu —
 *    on ne mesure pas la performance humaine."
 *
 * Une "trace" = un événement laissé sur le lieu ce jour-là :
 *   - photo déposée
 *   - anomalie créée
 *   - note de site créée
 *   - intervention exécutée
 *
 * Retour : N jours du plus ANCIEN au plus RÉCENT, prêts pour rendu vertical
 * type "carnet de bord". Jours sans trace = count 0 (affichage "—" UI).
 */
export async function getSiteRecentRhythm(
  siteId: string,
  daysBack = 14,
): Promise<SiteRhythmDay[]> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)

  // Construire le squelette des N jours (du plus ancien au plus récent)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const days: SiteRhythmDay[] = []
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    const iso = d.toISOString().slice(0, 10)
    const weekday = d.getUTCDay()
    days.push({
      date: iso,
      weekdayLabel: FR_WEEKDAYS_SHORT[weekday],
      dayMonthLabel: String(d.getUTCDate()),
      isToday: i === 0,
      isWeekend: weekday === 0 || weekday === 6,
      count: 0,
    })
  }
  const indexByDate = new Map(days.map((d, idx) => [d.date, idx]))

  if (missionIds.length === 0) return days

  const sinceIso = days[0].date + 'T00:00:00.000Z'

  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id, executed_at')
    .in('mission_id', missionIds)
    .gte('executed_at', sinceIso)
  const interventionRows = (interventionsAll ?? []) as Array<{
    id: string
    executed_at: string | null
  }>
  const interventionIds = interventionRows.map((i) => i.id)

  // Interventions exécutées
  for (const i of interventionRows) {
    if (!i.executed_at) continue
    const day = i.executed_at.slice(0, 10)
    const idx = indexByDate.get(day)
    if (idx !== undefined) days[idx].count += 1
  }

  if (interventionIds.length > 0) {
    const [photosRes, anomaliesRes] = await Promise.all([
      supabase
        .from('intervention_photos')
        .select('taken_at')
        .in('intervention_id', interventionIds)
        .gte('taken_at', sinceIso),
      supabase
        .from('intervention_anomalies')
        .select('created_at')
        .in('intervention_id', interventionIds)
        .gte('created_at', sinceIso),
    ])
    for (const p of (photosRes.data ?? []) as Array<{ taken_at: string }>) {
      const idx = indexByDate.get(p.taken_at.slice(0, 10))
      if (idx !== undefined) days[idx].count += 1
    }
    for (const a of (anomaliesRes.data ?? []) as Array<{ created_at: string }>) {
      const idx = indexByDate.get(a.created_at.slice(0, 10))
      if (idx !== undefined) days[idx].count += 1
    }
  }

  // Notes du site
  const { data: notes } = await supabase
    .from('site_notes')
    .select('created_at')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .gte('created_at', sinceIso)
  for (const n of (notes ?? []) as Array<{ created_at: string }>) {
    const idx = indexByDate.get(n.created_at.slice(0, 10))
    if (idx !== undefined) days[idx].count += 1
  }

  return days
}

// =============================================================================
// SECTION 8 — PRÉSENCES HUMAINES RÉCENTES (sans ranking, sans comptage)
// =============================================================================

/**
 * Présences humaines récentes — prénoms uniques sur la fenêtre.
 *
 * Doctrine Vincent 2026-05-15 :
 *   "Tu ressens les humains qui habitent le lieu. Tu ne les compares pas."
 *
 * Sources : photos.taken_by + site_notes.created_by + intervention_anomalies
 * (created/resolved par lookup user). On exclut les rôles non-terrain
 * (admin pur) pour rester cohérent avec "ce site est habité par".
 *
 * Pas de comptage. Pas de ranking. Ordre alphabétique strict (anti-leaderboard).
 */
export async function getSiteHumanPresences(
  siteId: string,
  periodDays = 30,
): Promise<HumanPresences> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) {
    return { firstNames: [], periodDays }
  }

  const sinceIso = new Date(Date.now() - periodDays * 86_400_000).toISOString()

  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
  const interventionIds = (interventionsAll ?? []).map((i) => i.id)

  const userIds = new Set<string>()

  if (interventionIds.length > 0) {
    const { data: photos } = await supabase
      .from('intervention_photos')
      .select('taken_by')
      .in('intervention_id', interventionIds)
      .gte('taken_at', sinceIso)
      .not('taken_by', 'is', null)
    for (const p of (photos ?? []) as Array<{ taken_by: string }>) {
      userIds.add(p.taken_by)
    }
  }

  const { data: notes } = await supabase
    .from('site_notes')
    .select('created_by')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .gte('created_at', sinceIso)
    .not('created_by', 'is', null)
  for (const n of (notes ?? []) as Array<{ created_by: string }>) {
    userIds.add(n.created_by)
  }

  if (userIds.size === 0) {
    return { firstNames: [], periodDays }
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email')
    .in('id', Array.from(userIds))
  const firstNames = ((users ?? []) as Array<{
    id: string
    full_name: string | null
    email: string
  }>)
    .map((u) => firstNameOf(u.full_name, u.email))
    .filter((n) => n.length > 0)

  // Dédupe + tri alphabétique (anti-ranking)
  const unique = Array.from(new Set(firstNames)).sort((a, b) =>
    a.localeCompare(b, 'fr', { sensitivity: 'base' }),
  )

  return { firstNames: unique, periodDays }
}

// =============================================================================
// SECTION 9 — PRÉSENCES D'ÉQUIPES (swap doctrinal Vincent 2026-05-15)
// =============================================================================

/**
 * Équipes présentes récemment sur ce site.
 *
 * Doctrine Vincent 2026-05-15 :
 *   "L'équipe = continuité collective, pas surveillance individuelle.
 *    Container logistique, pas personne — pas de reverse-lookup."
 *
 * Source : interventions.assigned_team_id sur la fenêtre. Tri alphabétique
 * (anti-leaderboard). Pas de comptage par équipe.
 */
export async function getSiteTeamPresences(
  siteId: string,
  periodDays = 30,
): Promise<TeamPresences> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) {
    return { teamNames: [], periodDays }
  }

  const sinceIso = new Date(Date.now() - periodDays * 86_400_000).toISOString()

  const { data: interventions } = await supabase
    .from('interventions')
    .select('assigned_team_id')
    .in('mission_id', missionIds)
    .gte('executed_at', sinceIso)
    .not('executed_at', 'is', null)
    .not('assigned_team_id', 'is', null)

  const teamIds = Array.from(
    new Set(
      ((interventions ?? []) as Array<{ assigned_team_id: string }>).map(
        (i) => i.assigned_team_id,
      ),
    ),
  )

  if (teamIds.length === 0) {
    return { teamNames: [], periodDays }
  }

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name')
    .in('id', teamIds)

  const teamNames = ((teams ?? []) as Array<{ id: string; name: string }>)
    .map((t) => t.name)
    .filter((n) => n.length > 0)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))

  return { teamNames, periodDays }
}

// =============================================================================
// SECTION 10 — COUCHE 3 / IA PERCEPTIVE : "LECTURES DU LIEU"
// =============================================================================

/**
 * Vincent 2026-05-15 — pilier doctrinal majeur :
 *
 *   "L'IA est un révélateur du réel, pas un générateur de texte.
 *    Pas dashboard. Pas reporting. Pas contrôle. Mais perception augmentée."
 *
 * Cette section produit des PHRASES FACTUELLES algorithmiquement extraites
 * de patterns faibles dans le corpus du site. Aucun appel LLM — uniquement
 * assemblage de constats observés (respect Pilier 4 : DG reste auteur).
 *
 * Trois types de constats V1 (applicables même avec peu de données pilote) :
 *   1. recurring_place    — un lieu mentionné ≥3 fois ces 90 derniers jours
 *   2. resolved_not_returned — anomalie résolue depuis Nj, pas réapparue
 *   3. absent_pattern     — un terme dominant qui a cessé d'apparaître
 *
 * À VENIR (V2 quand le substrat existe) :
 *   - co-occurrences temporelles (matin ↔ lieu)
 *   - saisonnalité ("pas de passage habituel en juillet-août")
 *   - changements de présence ("Sosefo est apparu en mai")
 *
 * Volontairement frugal : max 6 lectures par site. Si trop = bruit, perte
 * du caractère "lecture lente" voulu par Vincent.
 */

const LIEU_REGEX = /\b(bloc|couloir|salle|réserve|reserve|entrée|entree|sortie|étage|etage|niveau|hall|local|zone|sanitaire|sanitaires|vestiaire|vestiaires|cuisine|bureau|bureaux|chambre|chambres|pédiatrie|pediatrie|maternité|maternite|urgences)\s+([A-Za-zÀ-ÿ0-9]+)/gi

interface PlaceMention {
  label: string  // ex : "bloc B", "couloir pédiatrie"
  countRecent: number
  countOlder: number
  firstSeen: string  // ISO
  lastSeen: string  // ISO
}

function extractPlaces(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  LIEU_REGEX.lastIndex = 0
  while ((m = LIEU_REGEX.exec(text)) !== null) {
    const head = m[1].toLowerCase()
    const tail = m[2].toLowerCase()
    // Normalisation accents
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    out.push(`${norm(head)} ${norm(tail)}`)
  }
  return out
}

function monthYearLabel(iso: string): string {
  const d = new Date(iso)
  const m = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return m.charAt(0).toUpperCase() + m.slice(1)
}

function relativeWeeksLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 14) return `depuis ${days} jour${days > 1 ? 's' : ''}`
  const weeks = Math.floor(days / 7)
  if (weeks < 9) return `depuis ${weeks} semaines`
  const months = Math.floor(days / 30)
  return `depuis ${months} mois`
}

export async function getSiteReadings(siteId: string): Promise<SiteReadings> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) return { readings: [] }

  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id, notes, executed_at, scheduled_at')
    .in('mission_id', missionIds)
  const interventionRows = (interventionsAll ?? []) as Array<{
    id: string
    notes: string | null
    executed_at: string | null
    scheduled_at: string
  }>
  const interventionIds = interventionRows.map((i) => i.id)

  // Charge anomalies (toutes) + site_notes
  const [anomaliesRes, siteNotesRes] = await Promise.all([
    interventionIds.length > 0
      ? supabase
          .from('intervention_anomalies')
          .select('id, intervention_id, description, category, category_other, status, created_at, resolved_at')
          .in('intervention_id', interventionIds)
      : { data: [] as Array<{ id: string; intervention_id: string; description: string | null; category: string; category_other: string | null; status: string; created_at: string; resolved_at: string | null }> },
    supabase
      .from('site_notes')
      .select('body, created_at')
      .eq('site_id', siteId)
      .is('deleted_at', null),
  ])

  const anomalyRows = (anomaliesRes.data ?? []) as Array<{
    id: string
    intervention_id: string
    description: string | null
    category: string
    category_other: string | null
    status: string
    created_at: string
    resolved_at: string | null
  }>

  const siteNoteRows = (siteNotesRes.data ?? []) as Array<{
    body: string
    created_at: string
  }>

  const readings: SiteReading[] = []

  // --- 1. LIEUX RÉCURRENTS (≥3 mentions sur 90j) -----------------------------
  const HORIZON_RECENT_DAYS = 90
  const recentCutoff = Date.now() - HORIZON_RECENT_DAYS * 86_400_000

  const placeMentions = new Map<string, PlaceMention>()

  function addPlaces(text: string, occurredAtIso: string) {
    const places = extractPlaces(text)
    const isRecent = new Date(occurredAtIso).getTime() >= recentCutoff
    for (const p of places) {
      const existing = placeMentions.get(p)
      if (existing) {
        if (isRecent) existing.countRecent += 1
        else existing.countOlder += 1
        if (occurredAtIso < existing.firstSeen) existing.firstSeen = occurredAtIso
        if (occurredAtIso > existing.lastSeen) existing.lastSeen = occurredAtIso
      } else {
        placeMentions.set(p, {
          label: p,
          countRecent: isRecent ? 1 : 0,
          countOlder: isRecent ? 0 : 1,
          firstSeen: occurredAtIso,
          lastSeen: occurredAtIso,
        })
      }
    }
  }

  for (const i of interventionRows) {
    if (i.notes) addPlaces(i.notes, i.executed_at ?? i.scheduled_at)
  }
  for (const a of anomalyRows) {
    const text = a.description ?? a.category_other ?? ''
    if (text) addPlaces(text, a.created_at)
  }
  for (const n of siteNoteRows) {
    addPlaces(n.body, n.created_at)
  }

  // Top 3 lieux récurrents avec ≥3 mentions récentes
  const recurringPlaces = Array.from(placeMentions.values())
    .filter((p) => p.countRecent >= 3)
    .sort((a, b) => b.countRecent - a.countRecent)
    .slice(0, 3)

  for (const p of recurringPlaces) {
    readings.push({
      kind: 'recurring_place',
      axis: 'resonance',
      text: `${capitalize(p.label)} revient — ${p.countRecent} fois.`,
    })
  }

  // --- 2. ABSENCE NOTABLE : lieu mentionné avant, plus récemment ------------
  // Critère : countOlder ≥ 3 ET countRecent === 0 ET lastSeen > 30 jours
  const absent = Array.from(placeMentions.values())
    .filter((p) => p.countOlder >= 3 && p.countRecent === 0)
    .filter((p) => Date.now() - new Date(p.lastSeen).getTime() > 30 * 86_400_000)
    .sort((a, b) => b.countOlder - a.countOlder)
    .slice(0, 2)

  for (const p of absent) {
    readings.push({
      kind: 'absent_pattern',
      axis: 'absence',
      text: `${capitalize(p.label)} absent ${relativeWeeksLabel(p.lastSeen)}.`,
    })
  }

  // --- 3. ANOMALIES RÉSOLUES NON-RÉAPPARUES ----------------------------------
  // Une anomalie est "vraiment cicatrisée" si :
  //   - status='resolved' avec resolved_at
  //   - resolved_at > 30 jours
  //   - aucune nouvelle anomalie de même catégorie (ou même mot-clé) créée
  //     depuis le resolved_at
  const resolvedReadings: SiteReading[] = []
  const TRENTE_JOURS = 30 * 86_400_000

  const resolvedOld = anomalyRows
    .filter((a) => a.status === 'resolved' && a.resolved_at)
    .filter((a) => Date.now() - new Date(a.resolved_at!).getTime() > TRENTE_JOURS)
    .sort((a, b) => (b.resolved_at! < a.resolved_at! ? -1 : 1))

  for (const a of resolvedOld.slice(0, 6)) {
    // Heuristique : pas de réapparition = aucune nouvelle anomalie de même
    // catégorie ou contenant un mot-clé du descripteur, depuis resolved_at.
    const resolvedAt = a.resolved_at!
    const sameCategorySince = anomalyRows.some(
      (b) => b.id !== a.id && b.category === a.category && b.created_at > resolvedAt,
    )
    if (sameCategorySince) continue

    const label = (a.description || a.category_other || a.category).trim()
    if (!label) continue
    const labelShort = label.length > 50 ? label.slice(0, 50).trimEnd() + '…' : label

    resolvedReadings.push({
      kind: 'resolved_not_returned',
      axis: 'absence',
      text: `${capitalize(labelShort)} — résolu en ${monthYearLabel(resolvedAt)}, pas réapparu.`,
    })
    if (resolvedReadings.length >= 2) break
  }
  readings.push(...resolvedReadings)

  // --- 4. RÉSONANCES — consigne ↔ anomalie (Type A V1) ---------------------
  // Vincent 2026-05-15 : "L'IA rapproche, elle ne conclut pas."
  // Match par overlap de tokens significatifs entre note de site (consigne
  // "À savoir") et anomalie créée APRÈS la note (filtre temporel strict :
  // ≥7 jours d'écart pour vraie résonance, pas même session de saisie).
  const siteNotesAll = (siteNoteRows as Array<{ body: string; created_at: string }>)
  const SEPT_JOURS = 7 * 86_400_000
  const RESONANCE_MIN_OVERLAP = 2  // ≥2 tokens significatifs en commun

  function significantTokens(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !STOPWORDS_FR_SITE.has(w)),
    )
  }

  const resonances: SiteReading[] = []
  const resonanceSeenAnomalies = new Set<string>()

  for (const note of siteNotesAll) {
    const noteTokens = significantTokens(note.body)
    if (noteTokens.size === 0) continue
    const noteTime = new Date(note.created_at).getTime()

    for (const a of anomalyRows) {
      if (resonanceSeenAnomalies.has(a.id)) continue
      const anomalyTime = new Date(a.created_at).getTime()
      // Filtre temporel : note doit précéder l'anomalie d'au moins 7 jours
      if (anomalyTime - noteTime < SEPT_JOURS) continue

      const aText = a.description ?? a.category_other ?? ''
      const aTokens = significantTokens(aText)
      let overlap = 0
      for (const t of noteTokens) {
        if (aTokens.has(t)) overlap += 1
      }
      if (overlap < RESONANCE_MIN_OVERLAP) continue

      const noteShort = note.body.length > 60
        ? note.body.slice(0, 60).trimEnd() + '…'
        : note.body
      const anomalyShort = aText.length > 50 ? aText.slice(0, 50).trimEnd() + '…' : aText
      const noteMonth = monthYearLabel(note.created_at).toLowerCase()

      resonances.push({
        kind: 'resonance_note_anomaly',
        axis: 'resonance',
        text: `Consigne de ${noteMonth} (« ${noteShort} ») → anomalie « ${anomalyShort.toLowerCase()} ».`,
      })
      resonanceSeenAnomalies.add(a.id)
      if (resonances.length >= 2) break
    }
    if (resonances.length >= 2) break
  }
  // Résonances insérées EN PREMIER (priorité doctrinale Vincent 2026-05-15)
  readings.unshift(...resonances)

  // --- 5. PERSISTANCES — un lieu revient malgré N interventions -------------
  // Vincent 2026-05-15 : "Le bloc B revient malgré plusieurs interventions."
  // Détecte un lieu qui apparaît dans ≥3 anomalies dont ≥2 sont déjà résolues
  // (= des interventions ont eu lieu) — la zone résiste structurellement.
  // INTERDICTION ABSOLUE de relier cette persistance à une personne ou équipe.
  const placeAnomalies = new Map<string, { total: number; resolved: number }>()
  for (const a of anomalyRows) {
    const text = a.description ?? a.category_other ?? ''
    const place = extractFirstPlace(text)
    if (!place) continue
    const entry = placeAnomalies.get(place) ?? { total: 0, resolved: 0 }
    entry.total += 1
    if (a.status === 'resolved') entry.resolved += 1
    placeAnomalies.set(place, entry)
  }
  const persistences: SiteReading[] = []
  for (const [place, { total, resolved }] of placeAnomalies.entries()) {
    if (total >= 3 && resolved >= 2) {
      persistences.push({
        kind: 'persistence_place',
        axis: 'persistence',
        text: `${capitalize(place)} revient malgré ${resolved} intervention${resolved > 1 ? 's' : ''}.`,
      })
    }
  }
  // Persistances après résonances, avant le reste
  if (persistences.length > 0) {
    readings.splice(resonances.length, 0, ...persistences.slice(0, 2))
  }

  // Cap final
  return { readings: readings.slice(0, 6) }
}

function capitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// =============================================================================
// SECTION 11 — IA DE CONTINUITÉ : "TRANSMISSIONS" entre chefs d'équipe
// =============================================================================

/**
 * Vincent 2026-05-15 — pilier doctrinal :
 *
 *   "Pas RH. Pas scoring. Pas performance. Mais continuité de connaissance.
 *    Quand Moana reprend un site, on lui montre les bribes de mémoire
 *    laissées par Anaïs. L'IA devient TRANSMISSION."
 *
 *   "La mémoire des lieux disparaît avec les humains.
 *    NetoIAge la conserve, la relie, la transmet."
 *
 * Détection :
 *   1. Identifier le chef d'équipe actuel (isCurrent === true) si son
 *      firstSeenAt sur ce site est récent (< 120 jours)
 *   2. Identifier le prédécesseur immédiat (celui dont lastSeenAt précède
 *      firstSeenAt du current de moins de 120 jours)
 *   3. Pour ce prédécesseur, sur ses derniers passages sur ce site :
 *      - extraire les lieux récurrents dans les captions photo
 *      - identifier la dernière anomalie ouverte avant la transition
 *
 * Output exemples :
 *   - "Les dernières traces d'Anaïs mentionnaient souvent le bloc B."
 *   - "La dernière anomalie ouverte avant la transition concernait la plomberie."
 *   - "Anaïs a tenu ce site 14 mois avant la transition."
 *
 * INTERDICTION ABSOLUE :
 *   - Ne PAS comparer prédécesseur et successeur
 *   - Ne PAS évaluer la performance ni du prédécesseur ni du current
 *   - Ne PAS interpréter la transition ("Tagada a remplacé Bleue parce que...")
 */
export async function getSiteTransmissionReadings(
  siteId: string,
  continuity: HumanContinuity,
): Promise<SiteReading[]> {
  // 1. Identifier current + prédécesseur
  const current = continuity.predecessors.find((p) => p.isCurrent)
  if (!current) return []

  const currentSince = new Date(current.firstSeenAt).getTime()
  const daysSinceCurrentStarted = Math.floor((Date.now() - currentSince) / 86_400_000)
  // Transmission n'a de sens que si la prise de site est encore récente.
  // Au-delà de 120 jours, le current a sa propre mémoire — pas besoin de bribes.
  if (daysSinceCurrentStarted > 120) return []

  // Prédécesseur = celui dont lastSeenAt précède immédiatement currentSince
  const predecessor = continuity.predecessors
    .filter((p) => !p.isCurrent)
    .filter((p) => new Date(p.lastSeenAt).getTime() < currentSince)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0]

  if (!predecessor) return []

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

  // Fenêtre : 60 jours avant lastSeenAt du prédécesseur
  const windowEnd = predecessor.lastSeenAt
  const windowStart = new Date(
    new Date(predecessor.lastSeenAt).getTime() - 60 * 86_400_000,
  ).toISOString()

  // User.id du prédécesseur (match par firstName)
  const { data: maybeUsers } = await supabase
    .from('users')
    .select('id, full_name, email')
    .ilike('full_name', `${predecessor.firstName}%`)
  const matchingUserIds = ((maybeUsers ?? []) as Array<{
    id: string
    full_name: string | null
    email: string
  }>)
    .filter((u) => firstNameOf(u.full_name, u.email) === predecessor.firstName)
    .map((u) => u.id)

  // Collecter le corpus du prédécesseur sur la fenêtre :
  //   - captions photos
  //   - descriptions d'anomalies créées sur ses interventions
  const [photosRes, anomaliesRes] = await Promise.all([
    matchingUserIds.length > 0
      ? supabase
          .from('intervention_photos')
          .select('caption, intervention_id')
          .in('intervention_id', interventionIds)
          .in('taken_by', matchingUserIds)
          .gte('taken_at', windowStart)
          .lte('taken_at', windowEnd)
      : { data: [] as Array<{ caption: string | null; intervention_id: string }> },
    supabase
      .from('intervention_anomalies')
      .select('description, category, category_other, created_at')
      .in('intervention_id', interventionIds)
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd),
  ])

  // V5.1.4 — Doctrine Vincent 2026-05-15 (post-challenge fragmentaire) :
  // "L'IA ne raconte pas. Elle expose le tissu. Le cerveau humain fait lui-même
  //  les liens." On extrait des FRAGMENTS LEXICAUX (lieux + termes clés) plutôt
  //  qu'une synthèse narrative. C'est le pattern "carnet d'archiviste".
  const fragmentCount = new Map<string, number>()

  // Lieux dans les captions photos
  for (const p of (photosRes.data ?? []) as Array<{ caption: string | null }>) {
    if (!p.caption) continue
    const place = extractFirstPlace(p.caption)
    if (place) {
      fragmentCount.set(place, (fragmentCount.get(place) ?? 0) + 1)
    }
  }

  // Lieux + termes des anomalies
  for (const a of (anomaliesRes.data ?? []) as Array<{
    description: string | null
    category: string
    category_other: string | null
  }>) {
    const text = a.description ?? a.category_other ?? a.category
    if (!text) continue
    const place = extractFirstPlace(text)
    if (place) {
      fragmentCount.set(place, (fragmentCount.get(place) ?? 0) + 1)
    } else {
      // Fallback : utiliser la category (ex. "plomberie", "électricité")
      const cat = (a.category || '').toLowerCase().trim()
      if (cat.length >= 4 && !STOPWORDS_FR_SITE.has(cat)) {
        fragmentCount.set(cat, (fragmentCount.get(cat) ?? 0) + 1)
      }
    }
  }

  if (fragmentCount.size === 0) {
    // Pas assez de matière pour exposer un tissu. La transmission ne s'invente
    // pas — si rien, on se tait (doctrine "l'IA attend, accumule, observe").
    return []
  }

  // Top fragments, alphabétiquement après filtre par fréquence (anti-ranking visuel)
  const fragments = Array.from(fragmentCount.entries())
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1]) // d'abord top par fréquence
    .slice(0, 6)
    .map(([f]) => f)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })) // puis alpha

  return [
    {
      kind: 'transmission',
      axis: 'transmission',
      text: `Avant la reprise par ${current.firstName} :`,
      fragments,
    },
  ]
}

function spanMonthsLabel(months: number): string {
  if (months < 1) return 'moins d’un mois'
  if (months === 1) return '1 mois'
  if (months < 12) return `${months} mois`
  const years = Math.floor(months / 12)
  const remainder = months % 12
  if (remainder === 0) return years === 1 ? '1 an' : `${years} ans`
  return `${years} an${years > 1 ? 's' : ''} et ${remainder} mois`
}

// =============================================================================
// SECTION — COCKPIT MATIN : "Ce que les lieux disent ce matin"
// =============================================================================

export interface TenantMorningReading {
  /** 1 seul fragment, ou null si le moteur n'a rien à révéler ce matin. */
  reading: SiteReading | null
  siteName: string | null
  siteId: string | null
}

/**
 * Vincent 2026-05-15 — pilier doctrinal "phénomènes rares" :
 *
 *   "Une IA qui parle tout le temps devient du bruit. Une IA qui se tait
 *    crée de la valeur quand elle parle. Sur le dashboard matin : 1 fragment
 *    MAXIMUM. Pas 2. Pas 4. Un."
 *
 * On parcourt les sites des contrats actifs du tenant (cap 15 pour rester
 * tenable au scale pilote), on récolte leurs lectures, et on retourne UN
 * fragment selon une priorité éditoriale fixe :
 *   1. transmission (relais — pertinent quand un chef vient de prendre)
 *   2. resonance_note_anomaly (écho temporel — densité humaine forte)
 *   3. persistence_place (motif qui résiste)
 *   4. absent_pattern (silence visible)
 *   5. recurring_place (retour de lieu)
 *   6. resolved_not_returned (cicatrice qui ne revient pas)
 *
 * Si aucun site n'a de reading → retourne null. Le cockpit affiche du vide
 * assumé, jamais de remplissage type "Aucun signal" ou "Tout est calme".
 */
const PRIORITY_BY_KIND: Record<SiteReading['kind'], number> = {
  transmission: 1,
  resonance_note_anomaly: 2,
  persistence_place: 3,
  absent_pattern: 4,
  recurring_place: 5,
  resolved_not_returned: 6,
}

/**
 * Récolte agrégée des readings de tous les sites d'un contrat, classés par
 * priorité éditoriale, capés à `limit`.
 *
 * Usage : page publique `/p/[token]` (rapport mensuel client). Vincent
 * 2026-05-15 : "Sur les surfaces client externe, zéro sophistication visible.
 * Le client doit ressentir 'ce système se souvient', pas voir une feature IA."
 * Donc on retourne uniquement `string[]` (les textes), pas la structure
 * SiteReading complète — le composant client n'a pas à connaître les axes.
 */
export async function getContractTopReadings(
  contractId: string,
  limit = 3,
): Promise<string[]> {
  const supabase = createAdminClient()
  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .eq('contract_id', contractId)
    .is('deleted_at', null)
    .limit(10)

  const siteIds = (sites ?? []).map((s) => s.id)
  if (siteIds.length === 0) return []

  const allReadings = await Promise.all(
    siteIds.map(async (siteId) => {
      const [r, c] = await Promise.all([
        getSiteReadings(siteId),
        getSiteHumanContinuity(siteId),
      ])
      const t = await getSiteTransmissionReadings(siteId, c)
      return [...t, ...r.readings]
    }),
  )

  const flat: SiteReading[] = allReadings.flat()
  if (flat.length === 0) return []

  flat.sort((a, b) => {
    const pa = PRIORITY_BY_KIND[a.kind] ?? 99
    const pb = PRIORITY_BY_KIND[b.kind] ?? 99
    return pa - pb
  })

  // Dédupliquer par texte exact (au cas où plusieurs sites ressortent la même
  // tournure, ce qui est rare mais possible).
  const seen = new Set<string>()
  const result: string[] = []
  for (const r of flat) {
    if (seen.has(r.text)) continue
    seen.add(r.text)
    result.push(r.text)
    if (result.length >= limit) break
  }
  return result
}

export async function getTenantTopMorningReading(): Promise<TenantMorningReading> {
  const supabase = createAdminClient()

  // Sites des contrats actifs (cap 15 sites pour V1 pilote).
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, contract:contracts(status)')
    .is('deleted_at', null)
    .limit(50) // cap dur pour éviter d'imploser à scale

  const activeSites = ((sites ?? []) as Array<{
    id: string
    name: string
    contract: { status: string } | { status: string }[] | null
  }>)
    .filter((s) => {
      const c = Array.isArray(s.contract) ? s.contract[0] : s.contract
      return c?.status === 'active'
    })
    .slice(0, 15)

  if (activeSites.length === 0) {
    return { reading: null, siteName: null, siteId: null }
  }

  // Récolte des readings de chaque site, en parallèle
  const allReadings = await Promise.all(
    activeSites.map(async (s) => {
      const [readings, continuity] = await Promise.all([
        getSiteReadings(s.id),
        getSiteHumanContinuity(s.id),
      ])
      const transmissions = await getSiteTransmissionReadings(s.id, continuity)
      const combined = [...transmissions, ...readings.readings]
      return { siteId: s.id, siteName: s.name, readings: combined }
    }),
  )

  // Aplatir et choisir par priorité, en cas d'égalité on prend le 1er (ordre
  // alphabétique des sites — anti-ranking, prévisibilité).
  type Candidate = { siteId: string; siteName: string; reading: SiteReading }
  const candidates: Candidate[] = []
  for (const s of allReadings) {
    for (const r of s.readings) {
      candidates.push({ siteId: s.siteId, siteName: s.siteName, reading: r })
    }
  }

  if (candidates.length === 0) {
    return { reading: null, siteName: null, siteId: null }
  }

  candidates.sort((a, b) => {
    const pa = PRIORITY_BY_KIND[a.reading.kind] ?? 99
    const pb = PRIORITY_BY_KIND[b.reading.kind] ?? 99
    if (pa !== pb) return pa - pb
    return a.siteName.localeCompare(b.siteName, 'fr', { sensitivity: 'base' })
  })

  const top = candidates[0]
  return {
    reading: top.reading,
    siteName: top.siteName,
    siteId: top.siteId,
  }
}

// =============================================================================
// SECTION 12 — MÉTA MÉMOIRE (pour wording lieu-centric des empty states)
// =============================================================================

/**
 * Vincent 2026-05-15 : "Même sans événement, la section doit parler."
 *
 * Récolte des faits descriptifs utilisables comme empty state évocateur :
 *   - première trace déposée sur le site (date)
 *   - nombre total de traces
 *   - dernière anomalie cicatrisée (description + date résolution)
 *
 * Aucune interprétation. Que des faits.
 */
export async function getSiteMemoryMeta(siteId: string): Promise<SiteMemoryMeta> {
  const supabase = createAdminClient()

  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)

  if (missionIds.length === 0) {
    return { firstTraceAt: null, totalTraces: 0, lastHealed: null }
  }

  const { data: interventionsAll } = await supabase
    .from('interventions')
    .select('id')
    .in('mission_id', missionIds)
  const interventionIds = (interventionsAll ?? []).map((i) => i.id)

  if (interventionIds.length === 0) {
    return { firstTraceAt: null, totalTraces: 0, lastHealed: null }
  }

  // Première trace + total
  const [photosRes, anomaliesRes, notesRes] = await Promise.all([
    supabase
      .from('intervention_photos')
      .select('taken_at', { count: 'exact' })
      .in('intervention_id', interventionIds)
      .order('taken_at', { ascending: true })
      .limit(1),
    supabase
      .from('intervention_anomalies')
      .select('id, description, category, category_other, resolved_at, status, created_at')
      .in('intervention_id', interventionIds)
      .eq('status', 'resolved')
      .order('resolved_at', { ascending: false })
      .limit(1),
    supabase
      .from('site_notes')
      .select('created_at', { count: 'exact' })
      .eq('site_id', siteId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1),
  ])

  const candidates: Array<{ at: string }> = []
  if ((photosRes.data ?? []).length > 0) candidates.push({ at: photosRes.data![0].taken_at })
  if ((notesRes.data ?? []).length > 0) candidates.push({ at: notesRes.data![0].created_at })

  const firstTraceAt = candidates.length > 0
    ? candidates.sort((a, b) => a.at.localeCompare(b.at))[0].at
    : null

  const totalTraces = (photosRes.count ?? 0) + (notesRes.count ?? 0)

  const lastHealedRow = (anomaliesRes.data ?? [])[0] as
    | {
        description: string | null
        category: string
        category_other: string | null
        resolved_at: string
      }
    | undefined

  const lastHealed = lastHealedRow
    ? {
        description: lastHealedRow.description || lastHealedRow.category_other || lastHealedRow.category,
        resolvedAt: lastHealedRow.resolved_at,
      }
    : null

  return { firstTraceAt, totalTraces, lastHealed }
}

// =============================================================================
// SECTION — GALERIE PHOTOS
// =============================================================================

export interface SitePhotoEntry {
  id: string
  signedUrl: string
  caption: string | null
  /** kind : 'passage' | 'anomaly' | 'anomaly_evidence' | 'before' | 'after' | 'proof' */
  kind: string
  takenAt: string
  interventionId: string
}

/**
 * Photos les plus pertinentes du site pour la galerie page Site.
 * Priorité : anomaly_evidence > captioned > recent.
 * Max 9 photos (grille 3×3).
 */
export async function getSiteRecentPhotos(
  siteId: string,
  limit = 9,
): Promise<SitePhotoEntry[]> {
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

  // Priorité photos : anomaly evidence > captioned > recent.
  // On récupère plus pour pouvoir trier, puis on coupe à limit.
  const { data: photosRaw } = await supabase
    .from('intervention_photos')
    .select('id, storage_path, caption, kind, taken_at, intervention_id')
    .in('intervention_id', interventionIds)
    .not('storage_path', 'is', null)
    .order('taken_at', { ascending: false })
    .limit(limit * 4)

  type PhotoRow = {
    id: string
    storage_path: string
    caption: string | null
    kind: string
    taken_at: string
    intervention_id: string
  }

  const rows = (photosRaw ?? []) as PhotoRow[]

  // Score de pertinence : anomaly* = 0, caption présente = 1, autres = 2.
  const score = (r: PhotoRow): number => {
    if (r.kind === 'anomaly_evidence' || r.kind === 'anomaly') return 0
    if (r.caption) return 1
    return 2
  }
  rows.sort((a, b) => score(a) - score(b) || b.taken_at.localeCompare(a.taken_at))
  const top = rows.slice(0, limit)
  if (top.length === 0) return []

  const storagePaths = top.map((p) => p.storage_path)
  const urlMap = await getSignedPhotoUrlsThumb(storagePaths)

  return top
    .map((p) => ({
      id: p.id,
      signedUrl: urlMap.get(p.storage_path) ?? '',
      caption: p.caption,
      kind: p.kind,
      takenAt: p.taken_at,
      interventionId: p.intervention_id,
    }))
    .filter((p) => p.signedUrl)
}
