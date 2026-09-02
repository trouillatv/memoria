import 'server-only'

// Canal historical_pdf — P0-B2
//
// Crée les canonical_subject_occurrence de canal 'historical_pdf' à partir des
// document_extraction_proposal d'un run de PV historique.
//
// Doctrine (identique à selectBestNote) :
//   - pooler label + description de toutes les propositions d'un groupe (cs, rapport)
//   - filtrer les textes non informatifs
//   - label et description sont choisis indépendamment (le meilleur de chaque)
//   - fallback sur le label canonical uniquement si rien d'informatif
//
// Idempotence : index UNIQUE PARTIEL cso_historical_pdf_uniq sur (canonical_subject_id, source_ref_id)
// evidence_count = nombre de propositions convergentes (multiplicité)

import { createAdminClient } from '@/lib/supabase/admin'
import { makeWinnerResolver, type SubjectRow } from '@/lib/db/canonical-subject-project'
import { detectActorRelations, type ActorSubject } from '@/lib/db/actor-citation'
import { deriveStateKey, deriveGroupThematicCategory } from '@/lib/db/occurrence-state-key'
import { extractEventDate } from '@/lib/documents/event-date'
import { deriveOccurrenceFromPvStates, verdictNormalizedToPvState, documentStatusToPvState, type PvState } from '@/lib/documents/subject-state'

// Familles qui portent PAR NATURE un état/événement daté d'un sujet durable (toujours éligibles).
// (vigilance/reservation conservés par compatibilité — ce sont des noms de kind jamais émis comme
// famille ; inertes mais sans effet de bord.)
const STATE_BEARING_FAMILIES = new Set(['action', 'vigilance', 'decision', 'knowledge_fact', 'deadline', 'reservation'])

/**
 * P3-B1 — Éligibilité d'une proposition à devenir une occurrence de mémoire longitudinale.
 *
 * Doctrine (P3-A §8) : une occurrence représente un ÉTAT/ÉVÉNEMENT daté SIGNIFICATIF d'un sujet
 * durable, PAS un type de proposition. On déplace la décision du contenant (famille) vers le
 * contenu :
 *  - les familles à état (action/decision/knowledge_fact/deadline…) sont éligibles par nature ;
 *  - `observation` — la famille ambiguë, jusqu'ici exclue par un bug de nommage (la whitelist
 *    listait le kind `vigilance` au lieu de la famille `observation`) — devient éligible SI son
 *    texte est SIGNIFICATIF, via le même garde générique que les relations (`selectBestText` /
 *    `isInformativeText`) : rejette le transitoire/éphémère (« à voir », « demain », < 15 car.),
 *    garde l'état daté substantiel (« Registre non renseigné », « Largeur réduite »).
 *
 * Pas de whitelist élargie aveugle, pas de nouveau moteur LLM. Limite connue : `isInformativeText`
 * ne filtre pas une observation SUBSTANTIELLE mais transitoire (« il pleuvait ce jour ») ; ce
 * résidu sémantique est instrumenté (log) et traité ultérieurement seulement si le terrain le montre.
 */
export function isProposalOccurrenceEligible(
  family: string,
  label: string | null,
  description: string | null,
): boolean {
  if (family === 'observation') {
    return selectBestText([label ?? '', description ?? '']) !== null
  }
  return STATE_BEARING_FAMILIES.has(family)
}

// Même doctrine que isInformativeText dans produce-relations-from-occurrences.ts
const TEMPORAL_START_RE =
  /^(la\s+semaine|ce\s+(?:soir|matin|midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|cette\s+semaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochain[e]?|prochainement|demain|[àa]\s+(?:voir|définir|confirmer|planifier|faire|réaliser)|tbd|sous\s+peu|dans\s+(?:la\s+semaine|\d))/i

const MIN_INFORMATIVE_CHARS = 15
const MAX_TEMPORAL_CHARS    = 50

export function isInformativeText(t: string): boolean {
  if (t.length < MIN_INFORMATIVE_CHARS) return false
  if (TEMPORAL_START_RE.test(t) && t.length < MAX_TEMPORAL_CHARS) return false
  return true
}

/** Sélectionne le texte le plus informatif dans un pool de candidats.
 *  Retourne null si aucun n'est informatif (fallback à gérer par l'appelant). */
export function selectBestText(candidates: string[]): string | null {
  const seen = new Set<string>()
  const pool = candidates
    .map(t => t.trim())
    .filter(t => t.length > 0 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
  const informative = pool.filter(isInformativeText)
  if (informative.length === 0) return null
  informative.sort((a, b) => b.length - a.length)
  return informative[0]
}

interface ProposalRow {
  id: string
  proposal_family: string
  label: string
  description: string | null
  source_excerpt: string | null
  subject_thread_id: string | null
  document_status: string | null
  source_page: number | null
  thematic_category: string | null
  // E2 : verdict normalisé E1 (source_payload.verdict) — préféré à document_status
  // pour la projection d'état quand il est présent (nouvelles extractions).
  source_payload: { verdict?: { normalized?: string | null } | null } | null
}

/**
 * E2 — PvState d'UNE proposition. Préfère le verdict normalisé E1
 * (`source_payload.verdict`) dès qu'il est présent ; à défaut (lignes d'avant E1,
 * jamais rejouées ici — le backfill est E3) retombe sur `document_status`.
 */
function proposalPvState(p: ProposalRow): PvState {
  const v = p.source_payload?.verdict
  if (v && typeof v === 'object') return verdictNormalizedToPvState(v.normalized ?? null)
  return documentStatusToPvState(p.document_status)
}

interface OccurrenceToCreate {
  canonical_subject_id: string
  canonical_label: string  // fallback si pool non informatif
  state_key: string        // P3-D1 : discriminateur d'état (une occurrence par état distinct)
  site_id: string
  source_ref_id: string    // site_reports.id
  effective_date: string
  proposals: ProposalRow[]
}

/**
 * Crée (ou ignore si déjà présentes) les canonical_subject_occurrence de canal
 * 'historical_pdf' pour toutes les propositions éligibles d'un run historique.
 *
 * Appelé à la matérialisation d'un PV historique, après que site_reports.id est créé.
 * Idempotent : utilise INSERT ... ON CONFLICT DO NOTHING via l'index cso_historical_pdf_uniq.
 */
export async function ensureHistoricalPdfOccurrences(params: {
  runId: string
  siteId: string
  siteReportId: string  // site_reports.id créé par materializeHistoricalVisit
  visitDate: string     // YYYY-MM-DD
}): Promise<{ created: number; skipped: number; errors: number }> {
  const { runId, siteId, siteReportId, visitDate } = params
  const supabase = createAdminClient()

  // 1. Charger les propositions éligibles du run avec leur subject_thread_id
  const { data: proposals, error: propErr } = await supabase
    .from('document_extraction_proposal')
    .select('id, proposal_family, label, description, source_excerpt, subject_thread_id, document_status, source_page, thematic_category, source_payload')
    .eq('extraction_run_id', runId)
    // P3-B1 : on récupère aussi les observations ; le garde de signification tranche ensuite.
    .in('proposal_family', [...STATE_BEARING_FAMILIES, 'observation'])
    .not('subject_thread_id', 'is', null)

  if (propErr) {
    console.error('[historical-occ] proposals fetch failed:', propErr.message)
    return { created: 0, skipped: 0, errors: 1 }
  }
  if (!proposals || proposals.length === 0) return { created: 0, skipped: 0, errors: 0 }

  // P3-B1 : filtre par signification du contenu (état daté d'un sujet durable), pas par famille.
  const fetched = proposals as ProposalRow[]
  const eligible = fetched.filter((p) => isProposalOccurrenceEligible(p.proposal_family, p.label, p.description))
  const obsTotal = fetched.filter((p) => p.proposal_family === 'observation').length
  const obsKept = eligible.filter((p) => p.proposal_family === 'observation').length
  if (obsTotal > 0) {
    // Instrumentation (visibilité d'un afflux type Géant) : combien d'observations franchissent le garde.
    console.log(`[historical-occ] run=${runId} observations éligibles ${obsKept}/${obsTotal} (garde de signification)`)
  }
  const threadIds = [...new Set(eligible.map(p => p.subject_thread_id as string))]

  // 2. Résoudre thread_id → canonical_subject_id via subject_thread_identity
  const { data: stiRows, error: stiErr } = await supabase
    .from('subject_thread_identity')
    .select('subject_thread_id, canonical_subject_id')
    .eq('site_id', siteId)
    .in('subject_thread_id', threadIds)

  if (stiErr) {
    console.error('[historical-occ] STI fetch failed:', stiErr.message)
    return { created: 0, skipped: 0, errors: 1 }
  }

  const threadToCs = new Map((stiRows ?? []).map(s => [s.subject_thread_id as string, s.canonical_subject_id as string]))

  // 3. Résoudre le winner actif de chaque canonical_subject référencé par la STI.
  //    Invariant : toute nouvelle canonical_subject_occurrence pointe vers le
  //    sujet vivant courant, jamais vers un loser fusionné (même si la STI,
  //    elle, n'a pas encore été reroutée — cf. MERGE-REFERENCE).
  const rawCsIds = [...new Set([...threadToCs.values()])]
  const { data: subjectRows } = await supabase
    .from('canonical_subject')
    .select('id, status, merged_into')
    .in('id', rawCsIds)
  const subjectCache = new Map<string, SubjectRow>(
    (subjectRows ?? []).map(r => [r.id as string, r as SubjectRow]),
  )
  const resolveWinner = makeWinnerResolver(supabase, subjectCache)
  const winnerByRawId = new Map<string, string>()
  for (const rawId of rawCsIds) {
    const resolved = await resolveWinner(rawId)
    if (resolved) winnerByRawId.set(rawId, resolved.id)
    // pas de winner résolu (cycle/impasse) → skip silencieux, comme un thread non promu
  }

  const winnerIds = [...new Set([...winnerByRawId.values()])]
  const { data: winnerRows } = await supabase
    .from('canonical_subject')
    .select('id, label')
    .in('id', winnerIds)
  const csLabelMap = new Map((winnerRows ?? []).map(c => [c.id as string, c.label as string]))

  // 3b. Acteurs DU DOCUMENT (kind=actor) — ceux réellement extraits/canonicalisés de CE run
  //     (propositions person/company → thread → canonical_subject), pas tous les acteurs du
  //     site. Sert à lier l'acteur cité dans le texte d'un fait à l'occurrence, avec un rôle.
  //     L'acteur reste une entité LIÉE au fait, jamais le sujet.
  const { data: actorProps } = await supabase
    .from('document_extraction_proposal')
    .select('subject_thread_id')
    .eq('extraction_run_id', runId)
    .in('proposal_family', ['person', 'company'])
    .not('subject_thread_id', 'is', null)
  const actorThreadIds = [...new Set((actorProps ?? []).map(p => p.subject_thread_id as string))]
  let actorList: ActorSubject[] = []
  if (actorThreadIds.length > 0) {
    const { data: actorSti } = await supabase
      .from('subject_thread_identity')
      .select('canonical_subject_id')
      .eq('site_id', siteId)
      .in('subject_thread_id', actorThreadIds)
    const actorCsIds = [...new Set((actorSti ?? []).map(s => s.canonical_subject_id as string))]
    if (actorCsIds.length > 0) {
      const { data: actorRows } = await supabase
        .from('canonical_subject')
        .select('id, label, aliases')
        .in('id', actorCsIds)
        .eq('kind', 'actor')
        .eq('status', 'active')
      actorList = (actorRows ?? []).map(r => ({ id: r.id as string, label: r.label as string, aliases: (r.aliases as string[] | null) ?? [] }))
    }
  }

  // 4. Grouper les propositions par (winner résolu, ÉTAT). P3-D1 : un état distinct = une occurrence ;
  //    les propositions de même état (même famille) sont dédupliquées dans l'unique occurrence.
  const groups = new Map<string, OccurrenceToCreate>()
  for (const p of eligible) {
    const rawCsId = threadToCs.get(p.subject_thread_id as string)
    if (!rawCsId) continue  // thread non encore promu en canonical_subject — skip silencieux
    const csId = winnerByRawId.get(rawCsId)
    if (!csId) continue  // chaîne de fusion cyclique/incomplète — skip silencieux
    const stateKey = deriveStateKey(p.proposal_family)
    const gkey = `${csId}::${stateKey}`
    if (!groups.has(gkey)) {
      groups.set(gkey, {
        canonical_subject_id: csId,
        canonical_label: csLabelMap.get(csId) ?? p.label,
        state_key: stateKey,
        site_id: siteId,
        source_ref_id: siteReportId,
        effective_date: visitDate,
        proposals: [],
      })
    }
    groups.get(gkey)!.proposals.push(p)
  }

  // 5. Créer les occurrences — une par groupe (cs, rapport)
  let created = 0
  let skipped = 0
  let errors  = 0

  for (const group of groups.values()) {
    const allLabels      = group.proposals.map(p => p.label)
    const allDescriptions = group.proposals.map(p => p.description ?? '').filter(Boolean)

    // Sélection indépendante du meilleur label et de la meilleure description
    const bestLabel = selectBestText(allLabels) ?? group.canonical_label
    const bestNote  = selectBestText(allDescriptions) ?? null

    // P3-D2 : date propre de l'événement (déterministe, brique event-date) — null si aucune date
    // fiable ; jamais la date du PV. Sur tous les textes de l'état (label/description/extrait).
    // Un état `deadline` porte une ÉCHÉANCE (due_date), pas un event_date → jamais d'event_date.
    const eventDate = group.state_key === 'deadline'
      ? null
      : extractEventDate(group.proposals.flatMap((p) => [p.label, p.description, p.source_excerpt])).iso

    // R-1 + E2 : tri-state longitudinal établi AU NIVEAU DU GROUPE state_key (pas du PV), à partir du
    // VERDICT NORMALISÉ E1 (fallback document_status pour les lignes d'avant E1). Conflit interne
    // (resolved ET open) → 'unknown', jamais masqué. On instrumente les conflits pour diagnostic.
    const { status: stateStatus, reason: stateReason } =
      deriveOccurrenceFromPvStates(group.proposals.map(proposalPvState))
    if (stateReason === 'conflict') {
      console.warn(`[historical-occ] CONFLIT statut → unknown | run=${runId} cs=${group.canonical_subject_id} `
        + `state_key=${group.state_key} pvStates=[${group.proposals.map((p) => proposalPvState(p)).join(',')}]`)
    }

    // R-1 : thematic_category classe le FAIT (instable au niveau sujet) → portée par l'occurrence.
    // Catégorie du groupe : univoque → valeur ; plusieurs → dominante déterministe + conflit journalisé.
    const { category: thematicCategory, reason: catReason, distinct: catDistinct } =
      deriveGroupThematicCategory(group.proposals.map((p) => p.thematic_category))
    if (catReason === 'conflict') {
      console.warn(`[historical-occ] CONFLIT catégorie → null | run=${runId} `
        + `cs=${group.canonical_subject_id} state_key=${group.state_key} catégories=[${catDistinct.join(',')}]`)
    }
    // source_page : provenance du fait ; groupe poolé → plus petite page (première mention).
    const sourcePage = group.proposals
      .map((p) => p.source_page)
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b)[0] ?? null

    const occData = {
      canonical_subject_id: group.canonical_subject_id,
      site_id: group.site_id,
      source_kind: 'historical_pdf' as const,
      source_ref_id: group.source_ref_id,
      source_proposal_id: null,
      visit_status: null,
      state_key: group.state_key,  // P3-D1 : partie de la clé d'unicité (un état = une occurrence)
      label: bestLabel,
      note: bestNote,
      evidence_count: group.proposals.length,  // preuves du même état poolées
      effective_date: group.effective_date,    // date documentaire (PV) — inchangée
      event_date: eventDate,                    // P3-D2 : date propre du fait (ou null)
      state_status: stateStatus,                // R-1 : tri-state du groupe (resolved|open|unknown)
      source_page: sourcePage,                  // R-1 : provenance du fait (page du PV)
      thematic_category: thematicCategory,      // R-1 : classification du fait (dominante du groupe)
      created_by: null,
      validation_status: 'observed' as const,
      entity_ids: [],
    }

    // INSERT ... ON CONFLICT DO NOTHING : l'index cso_historical_pdf_uniq gère l'idempotence.
    // On récupère l'id (créé OU existant) pour (re)poser les liens acteurs de façon idempotente.
    let occurrenceId: string | null = null
    const { data: ins, error: insertErr } = await supabase
      .from('canonical_subject_occurrence')
      .insert(occData)
      .select('id')
      .maybeSingle()

    if (insertErr) {
      if (insertErr.code === '23505') {
        skipped++
        const { data: existing } = await supabase
          .from('canonical_subject_occurrence')
          .select('id')
          .eq('canonical_subject_id', group.canonical_subject_id)
          .eq('source_ref_id', group.source_ref_id)
          .eq('source_kind', 'historical_pdf')
          .eq('state_key', group.state_key)  // P3-D1 : identité d'occurrence = (sujet, rapport, état)
          .maybeSingle()
        occurrenceId = (existing as { id: string } | null)?.id ?? null
      } else {
        console.error('[historical-occ] insert failed:', group.canonical_subject_id, insertErr.code, insertErr.message)
        errors++
      }
    } else {
      created++
      occurrenceId = (ins as { id: string } | null)?.id ?? null
    }

    // Liens ACTEUR ↔ OCCURRENCE (rôle dans le fait daté). Acteurs cités dans TOUT le texte du
    // fait, restreints aux acteurs du document. Idempotent (unique occ+actor+relation).
    if (occurrenceId && actorList.length > 0) {
      const relations = detectActorRelations([...allLabels, ...allDescriptions], actorList)
      if (relations.length > 0) {
        const { error: linkErr } = await supabase
          .from('canonical_subject_occurrence_actor_link')
          .upsert(
            relations.map(r => ({
              occurrence_id: occurrenceId,
              actor_subject_id: r.actorId,
              relation_type: r.relationType,
              source: 'auto_historical' as const,
              evidence_cue: r.evidenceCue,
            })),
            { onConflict: 'occurrence_id,actor_subject_id,relation_type', ignoreDuplicates: true },
          )
        if (linkErr) console.error('[historical-occ] actor link failed:', occurrenceId, linkErr.message)
      }
    }
  }

  return { created, skipped, errors }
}
