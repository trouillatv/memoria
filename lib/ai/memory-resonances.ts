// V5.1 Slice 5 — Atelier mémoire / mode Résonances.
//
// Doctrine Vincent 2026-05-14 :
//   - Curation uniquement, jamais génération libre.
//   - L'IA "RÉVÈLE" ce que les humains ont déjà déposé ; elle ne RÉSUME pas
//     et n'ajoute pas un mot.
//   - 3 verbes en surface : voici / fait écho / persiste-cesse.
//
// Approche V5.1 sans embeddings :
//   1. Récupère anomalies + site_notes + interventions.notes du site (180j).
//   2. Tokenise (>4 chars, hors stoplist FR).
//   3. Compte occurrences globales.
//   4. Pour les top mots ≥3 occurrences ET ≥30j entre première et dernière
//      → constitue un cluster.
//   5. Retourne le top 1 cluster avec ses events.
//
// L'étape 2 (embeddings) viendra en V5.2+ si FTS/comptage insuffisant.

import { createAdminClient } from '@/lib/supabase/admin'
import { assertCleanAiText } from './forbidden-words'

// Stoplist FR minimaliste — pas exhaustive, suffisant pour V5.1.
const STOPWORDS_FR = new Set([
  'avec', 'pour', 'dans', 'depuis', 'mais', 'donc', 'cette', 'cela', 'celui',
  'celle', 'sont', 'sera', 'etre', 'avoir', 'aussi', 'leur', 'leurs', 'plus',
  'moins', 'tres', 'bien', 'tout', 'tous', 'toute', 'toutes', 'sans', 'sous',
  'apres', 'avant', 'pendant', 'jusqu', 'comme', 'meme', 'autre', 'autres',
  'fait', 'faire', 'faut', 'voir', 'site', 'sites', 'note', 'notes', 'photo',
  'photos', 'jour', 'jours', 'mois', 'annee', 'semaine', 'matin', 'apres',
  'soir', 'oui', 'non', 'peut', 'peuvent', 'doit', 'doivent', 'sera',
])

interface SourceEvent {
  type: 'anomaly' | 'site_note' | 'intervention'
  id: string
  text: string
  occurredAt: string
  interventionId: string | null
}

export interface Resonance {
  /** Le mot/terme partagé par les events du cluster. */
  keyword: string
  /** Nombre d'occurrences total. */
  count: number
  /** Events du cluster, triés DESC chronologique. */
  events: SourceEvent[]
  /** Intro pré-rédigée, conforme wording IA verrouillé. */
  intro: string
}

function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire accents
    .replace(/[^a-z0-9]/g, '')
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length >= 4 && !STOPWORDS_FR.has(w))
}

function introFor(count: number): string {
  // Wording strictement borné aux 3 verbes autorisés.
  if (count <= 2) return 'Voici deux moments qui font écho.'
  if (count === 3) return 'Voici trois moments qui font écho.'
  if (count === 4) return 'Voici quatre fragments qui se ressemblent.'
  return 'Voici cinq fragments qui se ressemblent.'
}

/**
 * Détecte UNE résonance principale sur un site donné (mode minimum V5.1).
 *
 * Retourne null si aucun cluster cohérent (terme avec ≥3 occurrences ET
 * espacé d'au moins 30j entre la première et la dernière occurrence).
 *
 * Contraintes (cf. plan V5.1.2 § Slice 5) :
 *   - site_id obligatoire (jamais cross-site sans filtre explicite)
 *   - période limitée à 180j par défaut
 *   - requêtes prévisibles uniquement
 *   - limit stricte
 */
export async function findResonance(
  siteId: string,
  options: { periodDays?: number; topK?: number } = {},
): Promise<Resonance | null> {
  const periodDays = Math.min(365, Math.max(30, options.periodDays ?? 180))
  const topK = Math.min(5, Math.max(2, options.topK ?? 5))

  const supabase = createAdminClient()
  const since = new Date(Date.now() - periodDays * 86_400_000).toISOString()

  // 1) Récupère mission_ids du site
  const { data: missions } = await supabase
    .from('missions')
    .select('id')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionIds = (missions ?? []).map((m) => m.id)
  if (missionIds.length === 0) return null

  // 2) Récupère interventions du site sur la période
  const { data: interventionsRows } = await supabase
    .from('interventions')
    .select('id, notes, executed_at, scheduled_at')
    .in('mission_id', missionIds)
    .gte('scheduled_at', since)
  const interventionsArr = (interventionsRows ?? []) as Array<{
    id: string
    notes: string | null
    executed_at: string | null
    scheduled_at: string
  }>
  const interventionIds = interventionsArr.map((i) => i.id)

  // 3) Récupère anomalies (description) + site_notes (body) + interventions.notes
  const events: SourceEvent[] = []

  if (interventionIds.length > 0) {
    const { data: anomalies } = await supabase
      .from('intervention_anomalies')
      .select('id, description, intervention_id, created_at')
      .in('intervention_id', interventionIds)
    for (const a of (anomalies ?? []) as Array<{
      id: string
      description: string | null
      intervention_id: string
      created_at: string
    }>) {
      if (!a.description || a.description.trim().length === 0) continue
      events.push({
        type: 'anomaly',
        id: a.id,
        text: a.description,
        occurredAt: a.created_at,
        interventionId: a.intervention_id,
      })
    }
  }

  const { data: siteNotes } = await supabase
    .from('site_notes')
    .select('id, body, created_at')
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .gte('created_at', since)
  for (const n of (siteNotes ?? []) as Array<{
    id: string
    body: string
    created_at: string
  }>) {
    events.push({
      type: 'site_note',
      id: n.id,
      text: n.body,
      occurredAt: n.created_at,
      interventionId: null,
    })
  }

  for (const i of interventionsArr) {
    if (!i.notes || i.notes.trim().length === 0) continue
    events.push({
      type: 'intervention',
      id: i.id,
      text: i.notes,
      occurredAt: i.executed_at ?? i.scheduled_at,
      interventionId: i.id,
    })
  }

  if (events.length < 3) return null

  // 4) Compte occurrences globales
  const wordToEvents = new Map<string, SourceEvent[]>()
  for (const event of events) {
    const seenInEvent = new Set<string>()
    for (const word of tokenize(event.text)) {
      if (seenInEvent.has(word)) continue
      seenInEvent.add(word)
      const list = wordToEvents.get(word) ?? []
      list.push(event)
      wordToEvents.set(word, list)
    }
  }

  // 5) Garde uniquement les mots avec ≥3 occurrences ET ≥30j d'écart
  const RESONANCE_MIN_COUNT = 3
  const RESONANCE_MIN_SPAN_DAYS = 30
  type Candidate = { word: string; events: SourceEvent[]; spanDays: number }
  const candidates: Candidate[] = []
  for (const [word, evts] of wordToEvents.entries()) {
    if (evts.length < RESONANCE_MIN_COUNT) continue
    const sorted = [...evts].sort((a, b) =>
      a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0,
    )
    const first = new Date(sorted[0].occurredAt).getTime()
    const last = new Date(sorted[sorted.length - 1].occurredAt).getTime()
    const spanDays = Math.floor((last - first) / 86_400_000)
    if (spanDays < RESONANCE_MIN_SPAN_DAYS) continue
    candidates.push({ word, events: sorted.reverse(), spanDays })
  }

  if (candidates.length === 0) return null

  // 6) Top 1 : prioritise le span le plus large (résonance la plus persistante),
  //    puis le count le plus élevé. Cap à topK events.
  candidates.sort((a, b) => {
    if (b.spanDays !== a.spanDays) return b.spanDays - a.spanDays
    return b.events.length - a.events.length
  })
  const top = candidates[0]
  const cappedEvents = top.events.slice(0, topK)
  const intro = introFor(cappedEvents.length)

  // Test de cohérence wording (garde-fou défensif)
  assertCleanAiText(intro, 'memory-resonances.introFor')

  return {
    keyword: top.word,
    count: top.events.length,
    events: cappedEvents,
    intro,
  }
}
