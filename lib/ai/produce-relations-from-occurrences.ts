// Moteur de relations inter-sujets depuis les occurrences canoniques — P0-B1 terrain-first.
//
// Pipeline :
//   1. Charge les occurrences canoniques du site (source_kind IN ('field_visit', 'meeting', 'historical_pdf'))
//   2. Groupe par visite/réunion (source_ref_id) — TOUTES les occurrences par sujet sont conservées
//   3. Calcule les co-occurrences par paire de canonical_subject
//   4. Filtre : minCooccurrences, minLift, exclusion paires existantes
//   5. Classe par score combiné → top maxCandidatesPerRun
//   6. Guard same_subject (score ≥ 3 → log uniquement)
//   7. Qualification Gemini — extrait = meilleure note disponible (pas la première arbitraire)
//   8. Whitelist serveur : relates_to → rejeté avant INSERT (invariant P0-B1)
//   9. Evidence mandatory : au moins un extrait non-null (invariant P0-B1)
//  10. Écriture : canonical_subject_links + canonical_subject_link_evidence
//
// Contrat d'architecture :
//   Ce moteur lit exclusivement canonical_subject_occurrence.
//   Il ne lit PAS document_extraction_proposal (réservé au moteur PDF produce-relations-for-run).
//   P0-B2 branchera le PDF sur le même chemin en ajoutant source_kind='pdf'.

import type { SupabaseClient } from '@supabase/supabase-js'
import { RELATION_CANDIDATE_CONFIG as CFG } from './relation-producer-config'
import { qualifyLinkCandidate } from './qualify-link-candidates'
import type { CandidatePair, PairEvidence } from './qualify-link-candidates'

// ── Whitelist serveur ─────────────────────────────────────────────────────────

const ALLOWED_RELATION_TYPES = new Set(['requires', 'enables', 'validates', 'causes', 'replaces'])

// ── Types publics ─────────────────────────────────────────────────────────────

export type EvidenceSource = 'occurrence_note' | 'subject_label_fallback'

/** Toutes les notes disponibles pour une paire dans une visite donnée, +
 *  le texte effectivement sélectionné pour le LLM. */
export interface CandidateEvidenceEntry {
  visitDate:    string
  // Toutes les notes/labels disponibles pour ce sujet dans cette visite
  allNotesA:    string[]
  allNotesB:    string[]
  // Ce qui a été envoyé au LLM (meilleure note disponible)
  excerptSentA: string
  sourceA:      EvidenceSource
  excerptSentB: string
  sourceB:      EvidenceSource
}

export type CandidateDecision =
  | 'written'
  | 'no_relation'
  | 'same_subject'
  | 'skipped_whitelist'
  | 'skipped_low_conf'
  | 'skipped_no_evidence'
  | 'error'

export interface CandidateTrace {
  a:             string
  labelA:        string
  b:             string
  labelB:        string
  cooccurrences: number
  N:             number
  lift:          number
  confAB:        number
  confBA:        number
  /** Détail complet par visite commune : toutes les notes disponibles + ce qui a été envoyé. */
  evidences:     CandidateEvidenceEntry[]
  gemini: {
    linkType:      string
    direction:     string
    confidence:    number
    justification: string
  } | null
  decision:      CandidateDecision
}

export interface ProduceRelationsFromOccurrencesResult {
  totalVisits:             number
  totalPairs:              number
  filteredLowCooccurrence: number
  filteredLowLift:         number
  filteredExistingLink:    number
  skippedTopN:             number
  candidatesEvaluated:     number
  sameSubjectDetected:     number
  noRelation:              number
  relatesTo:               number
  directional:             number
  written:                 number
  skippedLowConf:          number
  skippedNoEvidence:       number
  errors:                  number
  trace?:                  CandidateTrace[]
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }

function normalizeText(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function tokenSet(s: string, minLen = 2) {
  return new Set(normalizeText(s).split(' ').filter(t => t.length >= minLen))
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 && b.size === 0) return 1
  const inter = [...a].filter(t => b.has(t)).length
  return inter / new Set([...a, ...b]).size
}
function extractCodes(label: string) {
  const m = label.match(/[A-Z]{2,}[\s.]*\d[\d.]+|\d[\d.]+[\s.]*[A-Z]{2,}/g) ?? []
  return new Set(m.map(s => s.replace(/\s+/g, '').toLowerCase()))
}

function sameSubjectScore(
  labelA: string, labelB: string,
  countA: number, countB: number, countAB: number,
  excerpts: Array<{ excerptA: string; excerptB: string }>,
): number {
  const nA = normalizeText(labelA), nB = normalizeText(labelB)
  const lj = jaccard(tokenSet(labelA), tokenSet(labelB))
  const excJ = excerpts.map(e => jaccard(tokenSet(e.excerptA, 3), tokenSet(e.excerptB, 3)))
  const cA = extractCodes(labelA), cB = extractCodes(labelB)
  let score = 0
  if (lj >= 0.70)                                          score++
  if (nA.includes(nB) || nB.includes(nA))                 score++
  if (countAB / Math.max(countA, countB) >= 0.90)         score++
  if (excerpts.length > 0 && excJ.filter(j => j >= 0.80).length / excerpts.length >= 0.75) score++
  if (cA.size > 0 && cB.size > 0 && [...cA].some(c => cB.has(c)))                          score++
  return score
}

// ── Structure interne — toutes les occurrences par (sujet, visite) ────────────
// Exported for unit tests only.

export interface OccurrenceData {
  occurrenceId:  string
  label:         string
  note:          string | null
  effectiveDate: string
  proposalId:    string | null
}

// ── Sélection de la meilleure evidence textuelle ──────────────────────────────
//
// Règle : note et label d'une occurrence sont des sources textuelles de valeur égale.
// L'une et l'autre entrent dans le pool ; seule la valeur informative détermine laquelle
// est transmise au LLM. Le label canonical (fallbackLabel) n'est utilisé qu'en recours ultime.
//
// Une formulation est informative si :
//   1. Elle dépasse MIN_INFORMATIVE_CHARS (formules trop courtes = bruit).
//   2. Elle ne débute pas par un marqueur purement temporel ET sa longueur est < MAX_TEMPORAL_CHARS
//      (ex. "La semaine prochaine" → rejeté ; "Vérification prévue la semaine prochaine" → conservé).
//
// "après" et "avant" sont exclus du marqueur temporel : ils introduisent du contenu
// métier ("après la finalisation de la dépose") et ne désignent pas une formulation isolée.

const TEMPORAL_START_RE =
  /^(la\s+semaine|ce\s+(?:soir|matin|midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|cette\s+semaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochain[e]?|prochainement|demain|[àa]\s+(?:voir|définir|confirmer|planifier|faire|réaliser)|tbd|sous\s+peu|dans\s+(?:la\s+semaine|\d))/i

const MIN_INFORMATIVE_CHARS = 15
const MAX_TEMPORAL_CHARS    = 50   // texte > 50 car. débutant par un marqueur porte du contenu métier

function isInformativeText(t: string): boolean {
  if (t.length < MIN_INFORMATIVE_CHARS) return false
  if (TEMPORAL_START_RE.test(t) && t.length < MAX_TEMPORAL_CHARS) return false
  return true
}

// Exported for unit tests only.
export function selectBestNote(occs: OccurrenceData[], fallbackLabel: string): { text: string; source: EvidenceSource } {
  // 1. Pool équitable — note et label ont le même statut
  const pool = occs.flatMap(o => [o.note?.trim() ?? '', o.label.trim()]).filter(t => t.length > 0)

  if (pool.length === 0) return { text: fallbackLabel, source: 'subject_label_fallback' }

  // 2. Déduplique (insensible à la casse et aux espaces)
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const t of pool) {
    const key = t.toLowerCase().replace(/\s+/g, ' ')
    if (!seen.has(key)) { seen.add(key); candidates.push(t) }
  }

  // 3. Filtrer les formulations non informatives
  const informative = candidates.filter(isInformativeText)

  // 4. Fallback canonical si rien d'informatif dans les occurrences
  if (informative.length === 0) return { text: fallbackLabel, source: 'subject_label_fallback' }

  // 5. Classer par longueur décroissante (longueur ≈ densité d'information)
  informative.sort((a, b) => b.length - a.length)

  // Enrichir si la meilleure est courte et des compléments existent
  if (informative[0].length < 60 && informative.length > 1) {
    return { text: informative.join(' — ').slice(0, 400), source: 'occurrence_note' }
  }

  return { text: informative[0], source: 'occurrence_note' }
}

// ── Config override (calibration / audit uniquement) ──────────────────────────

export interface RelationConfigOverride {
  minCooccurrences?:   number
  minLift?:            number
  maxCandidatesPerRun?: number
}

// ── Fonction principale ───────────────────────────────────────────────────────

export async function produceRelationsFromOccurrences(opts: {
  siteId:          string
  admin:           SupabaseClient
  dryRun?:         boolean
  triggerVisitId?: string
  /** Surcharge de configuration — usage calibration/audit uniquement, jamais production. */
  configOverride?: RelationConfigOverride
}): Promise<ProduceRelationsFromOccurrencesResult> {
  const { siteId, admin, dryRun = false, triggerVisitId, configOverride } = opts

  const cfg = {
    minCooccurrences:    configOverride?.minCooccurrences   ?? CFG.minCooccurrences,
    minLift:             configOverride?.minLift            ?? CFG.minLift,
    maxCandidatesPerRun: configOverride?.maxCandidatesPerRun ?? CFG.maxCandidatesPerRun,
  }

  const result: ProduceRelationsFromOccurrencesResult = {
    totalVisits: 0, totalPairs: 0,
    filteredLowCooccurrence: 0, filteredLowLift: 0, filteredExistingLink: 0, skippedTopN: 0,
    candidatesEvaluated: 0, sameSubjectDetected: 0,
    noRelation: 0, relatesTo: 0, directional: 0,
    written: 0, skippedLowConf: 0, skippedNoEvidence: 0, errors: 0,
  }
  const trace: CandidateTrace[] = []

  // 1. Sujets canoniques actifs du site
  const { data: canonicals } = await admin
    .from('canonical_subject').select('id, label, status')
    .eq('site_id', siteId).eq('status', 'active')
  const csLabel = new Map((canonicals ?? []).map(c => [c.id as string, c.label as string]))

  // 2. Occurrences canoniques : terrain, réunion et PV historiques (P0-B2)
  let occurrencesQuery = admin
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_ref_id, source_kind, label, note, effective_date, source_proposal_id')
    .eq('site_id', siteId)
    .in('source_kind', ['field_visit', 'meeting', 'historical_pdf'])

  if (triggerVisitId) {
    occurrencesQuery = occurrencesQuery.eq('source_ref_id', triggerVisitId)
  }

  const { data: occurrences } = await occurrencesQuery
  if (!occurrences || occurrences.length === 0) return result

  // 3. Index : visit_id → csId → TOUTES les OccurrenceData (pas seulement la première)
  const visitToCS  = new Map<string, Map<string, OccurrenceData[]>>()
  const csVisitSet = new Map<string, Set<string>>()

  for (const occ of occurrences) {
    const visitId = occ.source_ref_id as string
    const csId    = occ.canonical_subject_id as string

    if (!visitToCS.has(visitId)) visitToCS.set(visitId, new Map())
    const visitMap = visitToCS.get(visitId)!
    if (!visitMap.has(csId)) visitMap.set(csId, [])
    visitMap.get(csId)!.push({
      occurrenceId:  occ.id as string,
      label:         occ.label as string,
      note:          occ.note as string | null,
      effectiveDate: (occ.effective_date as string)?.slice(0, 10) ?? '?',
      proposalId:    occ.source_proposal_id as string | null,
    })

    if (!csVisitSet.has(csId)) csVisitSet.set(csId, new Set())
    csVisitSet.get(csId)!.add(visitId)
  }

  const N = visitToCS.size
  result.totalVisits = N
  if (N < cfg.minCooccurrences) return result

  const subjectsInTriggerVisit = triggerVisitId
    ? new Set([...(visitToCS.get(triggerVisitId) ?? new Map()).keys()])
    : null

  // 4. Co-occurrences par paire
  const pairVisits = new Map<string, Set<string>>()
  for (const [visitId, csMap] of visitToCS) {
    const arr = [...csMap.keys()]
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = pairKey(arr[i], arr[j])
        if (!pairVisits.has(key)) pairVisits.set(key, new Set())
        pairVisits.get(key)!.add(visitId)
      }
    }
  }
  result.totalPairs = pairVisits.size

  // 5. Liens existants → exclusion
  const { data: existingLinks } = await admin
    .from('canonical_subject_links').select('source_subject_id, target_subject_id')
    .eq('site_id', siteId)
  const excludedPairs = new Set<string>()
  for (const lk of existingLinks ?? []) {
    excludedPairs.add(pairKey(lk.source_subject_id, lk.target_subject_id))
  }

  // 6. Pool de candidats avec compteurs détaillés
  const candidates: {
    key: string; a: string; b: string
    countA: number; countB: number; countAB: number
    lift: number; confAB: number; confBA: number; combined: number
  }[] = []

  for (const [key, visitSet] of pairVisits) {
    const countAB = visitSet.size
    const [a, b] = key.split('|')

    if (!csLabel.has(a) || !csLabel.has(b)) continue
    if (subjectsInTriggerVisit && !subjectsInTriggerVisit.has(a) && !subjectsInTriggerVisit.has(b)) continue
    if (excludedPairs.has(key)) { result.filteredExistingLink++; continue }
    if (countAB < cfg.minCooccurrences) { result.filteredLowCooccurrence++; continue }

    const countA = csVisitSet.get(a)?.size ?? 0
    const countB = csVisitSet.get(b)?.size ?? 0
    if (countA === 0 || countB === 0) continue

    const lift = (countAB * N) / (countA * countB)
    if (lift < cfg.minLift) { result.filteredLowLift++; continue }

    candidates.push({
      key, a, b, countA, countB, countAB,
      lift, confAB: countAB / countA, confBA: countAB / countB,
      combined: lift * (countAB / N),
    })
  }

  const sorted = candidates.sort((x, y) => y.combined - x.combined || y.lift - x.lift)
  const top    = sorted.slice(0, cfg.maxCandidatesPerRun)
  result.skippedTopN = Math.max(0, sorted.length - top.length)

  // 7. Guard + Gemini + écriture
  for (const p of top) {
    result.candidatesEvaluated++

    const labelA = csLabel.get(p.a) ?? p.a
    const labelB = csLabel.get(p.b) ?? p.b

    const commonVisits = [...(pairVisits.get(p.key) ?? [])]

    // Pour chaque visite commune : collecter toutes les notes disponibles + sélectionner
    // la meilleure pour le LLM (première note réelle, sinon label)
    const evidenceEntries: CandidateEvidenceEntry[] = []
    const pairEvidenceForLLM: PairEvidence[] = []
    const occurrenceIdsForWrite: Array<{
      occurrenceIdA: string; occurrenceIdB: string
      proposalIdA: string | null; proposalIdB: string | null
      visitDate: string
    }> = []

    for (const visitId of commonVisits) {
      const visitMap = visitToCS.get(visitId)
      if (!visitMap) continue
      const occsA = visitMap.get(p.a) ?? []
      const occsB = visitMap.get(p.b) ?? []
      if (occsA.length === 0 || occsB.length === 0) continue

      const effectiveDate = occsA[0].effectiveDate

      // Toutes les textes disponibles (pour la trace) — note ET label de chaque occurrence
      const gatherTexts = (os: OccurrenceData[]) => {
        const seen = new Set<string>()
        return os.flatMap(o => [o.note?.trim() ?? '', o.label.trim()])
          .filter(t => t.length > 0 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
      }
      const allNotesA = gatherTexts(occsA)
      const allNotesB = gatherTexts(occsB)

      // Meilleur extrait pour le LLM : sélection informée (pas la première arbitraire)
      const { text: excerptA, source: sourceA } = selectBestNote(occsA, labelA)
      const { text: excerptB, source: sourceB } = selectBestNote(occsB, labelB)
      const refOccA = occsA[0]
      const refOccB = occsB[0]

      evidenceEntries.push({ visitDate: effectiveDate, allNotesA, allNotesB, excerptSentA: excerptA, sourceA, excerptSentB: excerptB, sourceB })

      if (excerptA.trim() || excerptB.trim()) {
        pairEvidenceForLLM.push({
          runId:       visitId,
          runDate:     effectiveDate,
          excerptA,
          excerptB,
          proposalIdA: refOccA.proposalId ?? '',
          proposalIdB: refOccB.proposalId ?? '',
        })
        occurrenceIdsForWrite.push({
          occurrenceIdA: refOccA.occurrenceId,
          occurrenceIdB: refOccB.occurrenceId,
          proposalIdA:   refOccA.proposalId,
          proposalIdB:   refOccB.proposalId,
          visitDate:     effectiveDate,
        })
      }
    }

    const validEvidenceForLLM = pairEvidenceForLLM.slice(0, 4)

    const pushTrace = (decision: CandidateDecision, gemini: CandidateTrace['gemini'] = null) => {
      if (dryRun) trace.push({ a: p.a, labelA, b: p.b, labelB, cooccurrences: p.countAB, N, lift: p.lift, confAB: p.confAB, confBA: p.confBA, evidences: evidenceEntries, gemini, decision })
    }

    if (validEvidenceForLLM.length === 0) {
      result.skippedNoEvidence++
      pushTrace('skipped_no_evidence')
      continue
    }

    const excerptPairs = validEvidenceForLLM.map(e => ({ excerptA: e.excerptA, excerptB: e.excerptB }))
    const guardScore   = sameSubjectScore(labelA, labelB, p.countA, p.countB, p.countAB, excerptPairs)

    if (guardScore >= 3) {
      result.sameSubjectDetected++
      pushTrace('same_subject')
      console.log(`[relations/occ] possible_same_subject: "${labelA}" / "${labelB}" (score ${guardScore}/5)`)
      continue
    }

    const pair: CandidatePair = {
      csIdA: p.a, labelA, famA: 'observation',
      csIdB: p.b, labelB, famB: 'observation',
      countA: p.countA, countB: p.countB, countAB: p.countAB, N,
      lift: p.lift, confAB: p.confAB, confBA: p.confBA,
      evidence: validEvidenceForLLM,
    }

    let qualResult
    try {
      qualResult = await qualifyLinkCandidate(pair)
    } catch {
      result.errors++
      pushTrace('error')
      continue
    }

    if (!qualResult || qualResult.linkType === 'no_relation') {
      result.noRelation++
      const geminiPayload = qualResult ? { linkType: qualResult.linkType, direction: qualResult.direction, confidence: qualResult.confidence, justification: qualResult.justification } : null
      pushTrace('no_relation', geminiPayload)
      continue
    }

    const { linkType, direction, confidence, justification, evidenceRunIds } = qualResult
    const geminiPayload = { linkType, direction, confidence, justification }

    if (!ALLOWED_RELATION_TYPES.has(linkType)) {
      result.relatesTo++
      pushTrace('skipped_whitelist', geminiPayload)
      console.log(`[relations/occ] rejected(${linkType}): "${labelA}" ↔ "${labelB}" (whitelist)`)
      continue
    }

    result.directional++

    if (confidence < CFG.minLlmConfidence) {
      result.skippedLowConf++
      pushTrace('skipped_low_conf', geminiPayload)
      continue
    }

    let sourceSubjectId: string, targetSubjectId: string
    if (direction === 'A_to_B')      { sourceSubjectId = p.a; targetSubjectId = p.b }
    else if (direction === 'B_to_A') { sourceSubjectId = p.b; targetSubjectId = p.a }
    else                             { sourceSubjectId = p.a < p.b ? p.a : p.b; targetSubjectId = p.a < p.b ? p.b : p.a }

    if (dryRun) {
      pushTrace('written', geminiPayload)
      result.written++
      continue
    }

    const { data: insertedLink, error: linkError } = await admin
      .from('canonical_subject_links')
      .insert({
        site_id:           siteId,
        source_subject_id: sourceSubjectId,
        target_subject_id: targetSubjectId,
        relation_type:     linkType,
        status:            'suggested',
        confidence,
        justification,
        evidence_run_id:   evidenceRunIds[0] ?? null,
      })
      .select('id').single()

    if (linkError) {
      if (linkError.code === '23505') {
        console.log(`[relations/occ] duplicate pair skipped: "${labelA}" ↔ "${labelB}"`)
      } else {
        console.error(`[relations/occ] insert error: ${linkError.message}`)
        result.errors++
      }
      continue
    }

    const linkId = insertedLink.id as string

    const evidenceToWrite = occurrenceIdsForWrite.slice(0, 4).flatMap(e => {
      const entries: object[] = []
      const entryA = pairEvidenceForLLM.find(pe => pe.runDate === e.visitDate)
      if (entryA?.excerptA?.trim()) {
        entries.push({
          link_id: linkId, occurrence_id: e.occurrenceIdA,
          evidence_text: entryA.excerptA.slice(0, 500),
          observed_at: e.visitDate, source_proposal_id: e.proposalIdA ?? null,
        })
      }
      if (entryA?.excerptB?.trim()) {
        entries.push({
          link_id: linkId, occurrence_id: e.occurrenceIdB,
          evidence_text: entryA.excerptB.slice(0, 500),
          observed_at: e.visitDate, source_proposal_id: e.proposalIdB ?? null,
        })
      }
      return entries
    })

    if (evidenceToWrite.length > 0) {
      const { error: evErr } = await admin.from('canonical_subject_link_evidence').insert(evidenceToWrite)
      if (evErr) console.error(`[relations/occ] evidence insert error: ${evErr.message}`)
    }

    result.written++
    console.log(`[relations/occ] suggested: ${linkType} conf=${confidence.toFixed(2)} "${labelA}" → "${labelB}"`)
  }

  if (dryRun) result.trace = trace
  return result
}
