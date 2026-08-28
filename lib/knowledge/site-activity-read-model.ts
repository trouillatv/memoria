import 'server-only'
import { TERRAIN_VISIT_ORIGINS } from '@/lib/field/visit-origins'

// Read-model D10 — activités parallèles réelles d'un chantier
//
// PROJECTION DE LECTURE, PAS UN MOTEUR D'ÉTAT.
//
// Objectif : rendre consommable par la Prévisite et le Copilote la réalité
// opérationnelle déjà présente dans les débriefs terrain (site_reports.debrief_analysis)
// et les objets métier ouverts, SOUS FORME D'ACTIVITÉS PARALLÈLES DATÉES —
// sans inventer une « phase globale » unique et sans créer d'identité métier.
//
// Décisions D9 respectées :
//  - canonical_subject n'est PAS la clé du read-model (identité mémoire ≠ avancement) ;
//  - modèle B (activités parallèles), jamais phase unique ;
//  - deux régimes de preuve : PV documentaire vs terrain narratif ;
//  - aucune fermeture automatique — signal « à reconfirmer » uniquement ;
//  - aucun LLM comme source de vérité d'un statut ;
//  - aucune migration, aucune persistance, lecture seule.

import { createAdminClient } from '@/lib/supabase/admin'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ActivityItem {
  /** Fragment textuel extrait du débrief (jamais réécrit). */
  label: string
  /** ISO date (YYYY-MM-DD) de l'occurrence/débrief source. */
  proofDate: string
  /** 'debrief:<report_id>'. */
  proofSource: string
  /** Verbe d'état détecté : démarrage explicite vs état en cours vs simple mention. */
  status: 'in_progress' | 'started' | 'mentioned'
}

export interface OpenTerrainItem {
  id: string
  title: string
  kind: 'action' | 'deadline'
  /** ISO date (YYYY-MM-DD) de création. */
  createdAt: string
  ageDays: number
}

export interface SiteActivityReadModel {
  /** Preuve terrain qu'une intervention a commencé. null = aucun signal. */
  interventionStarted: boolean | null
  /** « N » dans « Ne jour d'intervention » extrait du dernier débrief. null = absent. */
  dayIndex: number | null
  /** Activités portant un verbe d'état dans les débriefs récents (≤ 30 j). */
  activitiesInProgress: ActivityItem[]
  /** Activités apparues depuis la dernière venue (ou 7 j si aucune référence). */
  activitiesStartedRecently: ActivityItem[]
  /** Objets terrain encore ouverts (déterministe). */
  stillOpen: OpenTerrainItem[]
  /** Objets anciens ouverts (≥ 21 j) avec activité terrain récente compatible — SIGNALEMENT SEUL. */
  toReconfirm: OpenTerrainItem[]
}

// ── Détection déterministe ──────────────────────────────────────────────────

const ORDINALS: Record<string, number> = {
  premier: 1, première: 1, deuxième: 2, deuxieme: 2, second: 2, seconde: 2,
  troisième: 3, troisieme: 3, quatrième: 4, quatrieme: 4, cinquième: 5, cinquieme: 5,
  sixième: 6, sixieme: 6, septième: 7, septieme: 7, huitième: 8, huitieme: 8,
  neuvième: 9, neuvieme: 9, dixième: 10, dixieme: 10,
}

// « 4e jour d'intervention », « quatrième jour de chantier », « jour 1 du chantier »…
// L'ancre est le mot « jour » associé à « intervention » / « chantier » (borné).
const DAY_NUMERIC_RE = /(\d{1,2})\s*(?:e|è|er|ème|eme|re)?\s+jour\s+(?:de\s+(?:chantier|l['’ ]?intervention)|d['’]intervention|du\s+chantier)/i
const DAY_ORDINAL_RE = /(premier|première|deuxi[eè]me|second[e]?|troisi[eè]me|quatri[eè]me|cinqui[eè]me|sixi[eè]me|septi[eè]me|huiti[eè]me|neuvi[eè]me|dixi[eè]me)\s+jour\s+(?:de\s+(?:chantier|l['’ ]?intervention)|d['’]intervention|du\s+chantier)/i
// « jour 1 du chantier », « jour 4 d'intervention »
const DAY_SUFFIX_RE = /jour\s+(\d{1,2})\s+(?:de\s+(?:chantier|l['’ ]?intervention)|d['’]intervention|du\s+chantier)/i

/** Extrait le numéro de jour d'intervention d'un texte de débrief. null si absent. */
export function extractDayIndex(text: string): number | null {
  if (!text) return null
  const numeric = text.match(DAY_NUMERIC_RE)
  if (numeric) {
    const n = parseInt(numeric[1], 10)
    if (Number.isFinite(n) && n > 0 && n <= 60) return n
  }
  const suffix = text.match(DAY_SUFFIX_RE)
  if (suffix) {
    const n = parseInt(suffix[1], 10)
    if (Number.isFinite(n) && n > 0 && n <= 60) return n
  }
  const ordinal = text.match(DAY_ORDINAL_RE)
  if (ordinal) {
    const key = ordinal[1].toLocaleLowerCase('fr-FR')
    const n = ORDINALS[key] ?? ORDINALS[key.normalize('NFD').replace(/[̀-ͯ]/g, '')]
    if (n) return n
  }
  return null
}

// Verbes d'état : démarrage explicite vs état en cours.
// L'ordre compte : un « a débuté » prime sur un « en cours » (statut plus précis).
// NB : pas de \b en fin de motif — en JS `\b` traite « é » (U+00E9) comme
// non-word, donc « débuté, » n'aurait jamais matché après le « é » final.
// On borne le début par un espace/début de chaîne à la place.
const STARTED_RE = /(?:^|\s)(a\s+d[ée]but[ée]|a\s+d[ée]marr[ée]|a\s+commenc[ée]|a\s+[ée]t[ée]\s+(?:lanc[ée]e?|act[ée]e?|d[ée]marr[ée]e?)|est\s+lanc[ée]e?|a\s+[ée]t[ée]\s+entam[ée]e?)/i
const IN_PROGRESS_RE = /(?:^|\s)(en\s+cours|se\s+poursui|continue|avance|est\s+en\s+train)/i

/** Qualifie le fragment terrain par son verbe d'état. */
function classifyActivityStatus(text: string): ActivityItem['status'] | null {
  if (STARTED_RE.test(text)) return 'started'
  if (IN_PROGRESS_RE.test(text)) return 'in_progress'
  return null
}

/** Découpe un texte en phrases exploitables (déjà ponctuées par l'extraction). */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean)
}

/** Noyau normalisé d'une phrase (dédup exacte). */
function normalizeKey(sentence: string): string {
  return sentence
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Mots vides fréquents — écartés du calcul de recouvrement sémantique.
const STOPWORDS = new Set([
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'a', 'au', 'aux',
  'en', 'est', 'sont', 'ce', 'cet', 'cette', 'ne', 'pas', 'qui', 'que', 'sur',
  'pour', 'par', 'dans', 'son', 'sa', 'ses', 'il', 'elle', 'on', 'y', 'lot',
  'celui', 'cela', 'plus', 'avec', 'sera', 'seront', 'ete', 'etre',
])

/** Tokens significatifs (≥ 3 lettres, hors stopwords) d'une phrase. */
function significantTokens(sentence: string): Set<string> {
  const set = new Set<string>()
  for (const tok of normalizeKey(sentence).split(' ')) {
    if (tok.length >= 3 && !STOPWORDS.has(tok)) set.add(tok)
  }
  return set
}

/** Recouvrement de Jaccard-min : |A∩B| / min(|A|,|B|). */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / Math.min(a.size, b.size)
}

// ── Types internes de lecture ────────────────────────────────────────────────

type DebriefRow = {
  id: string
  started_at: string | null
  ended_at: string | null
  debrief_analysis: {
    summary?: unknown
    a_savoir?: unknown
    attention?: unknown
    decisions?: unknown
  } | null
}

type OpenObjectRow = {
  id: string
  title: string
  created_at: string
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function toIsoDay(iso: string | null): string | null {
  return iso ? iso.substring(0, 10) : null
}

function ageDays(createdAtDay: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(createdAtDay + 'T00:00:00Z').getTime()) / 86_400_000))
}

// ── Read-model principal ──────────────────────────────────────────────────────

const RECENT_DEBRIEF_WINDOW_DAYS = 30
const RECENT_STARTED_FALLBACK_DAYS = 7
const RECONFIRM_AGE_DAYS = 21

export interface BuildSiteActivityReadModelOptions {
  /** Référence « dernière venue » (SinceLastVisitSummary.at). Sinon fallback 7 j. */
  sinceLastVenueAt?: string | null
  /** Horloge injectable (tests). Défaut = maintenant. */
  now?: string
}

/**
 * Construit le read-model d'activités parallèles d'un chantier.
 *
 * Lecture seule : lit les débriefs terrain récents et les objets métier ouverts.
 * Ne modifie aucune donnée, ne ferme aucun objet, n'appelle aucun LLM.
 */
export async function buildSiteActivityReadModel(
  siteId: string,
  opts: BuildSiteActivityReadModelOptions = {},
): Promise<SiteActivityReadModel> {
  const supabase = createAdminClient()
  const nowMs = new Date(opts.now ?? new Date().toISOString()).getTime()
  const windowStart = new Date(nowMs - RECENT_DEBRIEF_WINDOW_DAYS * 86_400_000).toISOString()

  const [debriefsRes, actionsRes, deadlinesRes] = await Promise.all([
    supabase
      .from('site_reports')
      .select('id, started_at, ended_at, debrief_analysis')
      .eq('site_id', siteId)
      .is('deleted_at', null)
      // Débriefs de VISITES TERRAIN (les imports historiques ne sont pas des visites) — P0.5-Vérité.
      .in('origin', TERRAIN_VISIT_ORIGINS)
      .gte('started_at', windowStart)
      .order('started_at', { ascending: false })
      .limit(12),
    supabase
      .from('site_actions')
      .select('id, title, created_at')
      .eq('site_id', siteId)
      .in('status', ['open', 'planned']),
    supabase
      .from('site_deadlines')
      .select('id, title, created_at')
      .eq('site_id', siteId)
      .in('status', ['to_plan', 'planned']),
  ])

  const debriefs = (debriefsRes.data ?? []) as DebriefRow[]
  const openActions = (actionsRes.data ?? []) as OpenObjectRow[]
  const openDeadlines = (deadlinesRes.data ?? []) as OpenObjectRow[]

  // ── interventionStarted + dayIndex (déterministe, dernier débrief prioritaire) ──
  let interventionStarted: boolean | null = null
  let dayIndex: number | null = null
  for (const d of debriefs) {
    const a = d.debrief_analysis
    if (!a) continue
    const texts = [
      typeof a.summary === 'string' ? a.summary : '',
      ...asStringArray(a.a_savoir),
      ...asStringArray(a.attention),
    ]
    for (const t of texts) {
      const n = extractDayIndex(t)
      if (n !== null) {
        // Le débrief le plus récent gagne (boucle en ordre décroissant).
        if (dayIndex === null) dayIndex = n
        interventionStarted = true
      }
      if (interventionStarted === null && STARTED_RE.test(t)) interventionStarted = true
    }
    // On arrête au premier débrief qui porte un dayIndex : c'est le plus récent.
    if (dayIndex !== null) break
  }

  // ── activitiesInProgress : verbes d'état dans les débriefs récents ─────────────
  const activitiesInProgress: ActivityItem[] = []
  const seenActivity = new Set<string>()
  const sinceStartedMs = opts.sinceLastVenueAt
    ? new Date(opts.sinceLastVenueAt).getTime()
    : nowMs - RECENT_STARTED_FALLBACK_DAYS * 86_400_000
  const activitiesStartedRecently: ActivityItem[] = []

  // Empreintes de tokens significatifs des activités déjà retenues — pour écarter
  // une phrase de summary qui reformule un fait déjà porté par un bullet a_savoir.
  const seenTokenSets: Set<string>[] = []
  for (const d of debriefs) {
    const a = d.debrief_analysis
    if (!a) continue
    const proofDate = toIsoDay(d.started_at ?? d.ended_at) ?? ''
    const proofSource = `debrief:${d.id}`
    // a_savoir (bullets curés par l'extraction) prioritaire ; summary et decisions
    // en complément pour capter une activité absente des bullets.
    const candidates = [
      ...asStringArray(a.a_savoir),
      ...(typeof a.summary === 'string' ? splitSentences(a.summary) : []),
      ...asStringArray(a.decisions),
    ]
    const debriefStartedMs = d.started_at ? new Date(d.started_at).getTime() : 0
    for (const sentence of candidates) {
      const status = classifyActivityStatus(sentence)
      if (!status) continue
      // Dédup exacte (noyau normalisé).
      const key = normalizeKey(sentence)
      if (!key || seenActivity.has(key)) continue
      // Dédup sémantique légère : recouvrement de tokens significatifs ≥ 60 %
      // avec une activité déjà retenue → même fait reformulé, on ne le répète pas.
      const tokens = significantTokens(sentence)
      if (tokens.size > 0 && seenTokenSets.some((prev) => tokenOverlap(tokens, prev) >= 0.6)) continue
      seenActivity.add(key)
      seenTokenSets.push(tokens)
      const item: ActivityItem = { label: sentence, proofDate, proofSource, status }
      activitiesInProgress.push(item)
      // « apparue depuis la dernière venue » : le débrief lui-même est postérieur.
      if (debriefStartedMs > sinceStartedMs) activitiesStartedRecently.push(item)
    }
  }

  // ── stillOpen : objets métier ouverts (déterministe) ───────────────────────────
  const stillOpen: OpenTerrainItem[] = [
    ...openActions.map((a): OpenTerrainItem => {
      const createdAt = toIsoDay(a.created_at) ?? ''
      return { id: a.id, title: a.title, kind: 'action', createdAt, ageDays: ageDays(createdAt, nowMs) }
    }),
    ...openDeadlines.map((d): OpenTerrainItem => {
      const createdAt = toIsoDay(d.created_at) ?? ''
      return { id: d.id, title: d.title, kind: 'deadline', createdAt, ageDays: ageDays(createdAt, nowMs) }
    }),
  ].sort((a, b) => b.ageDays - a.ageDays)

  // ── toReconfirm : ancien ouvert (≥21 j) ET activité terrain récente ────────────
  // SIGNALEMENT SEUL — jamais une fermeture. La présence d'activité terrain récente
  // rend l'état de l'objet ancien incertain : à reconfirmer sur site.
  const hasRecentTerrainActivity = activitiesStartedRecently.length > 0
  const toReconfirm: OpenTerrainItem[] = hasRecentTerrainActivity
    ? stillOpen.filter((o) => o.ageDays >= RECONFIRM_AGE_DAYS)
    : []

  return {
    interventionStarted,
    dayIndex,
    activitiesInProgress,
    activitiesStartedRecently,
    stillOpen,
    toReconfirm,
  }
}
