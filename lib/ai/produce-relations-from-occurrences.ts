// Moteur de relations inter-sujets depuis les occurrences canoniques — P0-B1 terrain-first.
//
// Pipeline :
//   1. Charge les occurrences canoniques du site (source_kind IN ('field_visit', 'meeting'))
//   2. Groupe par visite/réunion (source_ref_id)
//   3. Calcule les co-occurrences par paire de canonical_subject
//   4. Filtre : minCooccurrences, minLift, exclusion paires existantes
//   5. Classe par score combiné → top maxCandidatesPerRun
//   6. Guard same_subject (score ≥ 3 → log uniquement)
//   7. Qualification Gemini
//   8. Whitelist serveur : relates_to → rejeté avant INSERT (invariant P0-B1)
//   9. Evidence mandatory : au moins un extrait non-null (invariant P0-B1)
//  10. Écriture : canonical_subject_links + canonical_subject_link_evidence
//
// Contrat d'architecture :
//   Ce moteur lit exclusivement canonical_subject_occurrence.
//   Il ne lit PAS document_extraction_proposal (réservé au moteur PDF produce-relations-for-run).
//   P0-B2 branchera le PDF sur le même chemin en ajoutant source_kind='pdf'.
//
// Différence critique avec produce-relations-for-run.ts :
//   - Source  : canonical_subject_occurrence (niveau canonical, pas thread)
//   - Unité   : visite/réunion (source_ref_id), pas extraction_run_id
//   - Cible   : canonical_subject_links + link_evidence (pas subject_thread_links)
//   - Whitelist serveur : relates_to interdit, jamais écrit
//   - Evidence texte obligatoire avant tout INSERT

import type { SupabaseClient } from '@supabase/supabase-js'
import { RELATION_CANDIDATE_CONFIG as CFG } from './relation-producer-config'
import { qualifyLinkCandidate } from './qualify-link-candidates'
import type { CandidatePair, PairEvidence } from './qualify-link-candidates'

// ── Whitelist serveur ─────────────────────────────────────────────────────────

const ALLOWED_RELATION_TYPES = new Set(['requires', 'enables', 'validates', 'causes', 'replaces'])

// ── Utilitaires (copiés de produce-relations-for-run pour cohérence) ──────────

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

// ── Interface publique ────────────────────────────────────────────────────────

export interface ProduceRelationsFromOccurrencesResult {
  candidatesEvaluated: number
  sameSubjectDetected: number
  noRelation:          number
  relatesTo:           number   // rejeté côté serveur (whitelist P0-B1)
  directional:         number
  written:             number
  skippedLowConf:      number
  skippedNoEvidence:   number
  errors:              number
}

// ── Structure interne : occurrence par sujet dans une visite ──────────────────

interface OccurrenceData {
  occurrenceId:  string
  label:         string
  note:          string | null
  effectiveDate: string       // YYYY-MM-DD
  proposalId:    string | null
}

// ── Fonction principale ───────────────────────────────────────────────────────

export async function produceRelationsFromOccurrences(opts: {
  siteId:          string
  admin:           SupabaseClient
  dryRun?:         boolean   // si true : aucune écriture, log uniquement
  triggerVisitId?: string    // optionnel : filtre incrémental (une visite/réunion)
}): Promise<ProduceRelationsFromOccurrencesResult> {
  const { siteId, admin, dryRun = false, triggerVisitId } = opts

  const result: ProduceRelationsFromOccurrencesResult = {
    candidatesEvaluated: 0, sameSubjectDetected: 0,
    noRelation: 0, relatesTo: 0, directional: 0,
    written: 0, skippedLowConf: 0, skippedNoEvidence: 0, errors: 0,
  }

  // 1. Sujets canoniques actifs du site
  const { data: canonicals } = await admin
    .from('canonical_subject').select('id, label, status')
    .eq('site_id', siteId).eq('status', 'active')
  const csLabel = new Map((canonicals ?? []).map(c => [c.id as string, c.label as string]))

  // 2. Occurrences canoniques terrain + réunion
  let occurrencesQuery = admin
    .from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_ref_id, source_kind, label, note, effective_date, source_proposal_id')
    .eq('site_id', siteId)
    .in('source_kind', ['field_visit', 'meeting'])

  if (triggerVisitId) {
    occurrencesQuery = occurrencesQuery.eq('source_ref_id', triggerVisitId)
  }

  const { data: occurrences } = await occurrencesQuery

  if (!occurrences || occurrences.length === 0) return result

  // 3. Index : visit_id → canonical_subject_id → OccurrenceData
  //    (une seule occurrence par sujet par visite — on prend la première)
  const visitToCS = new Map<string, Map<string, OccurrenceData>>()
  const csVisitSet = new Map<string, Set<string>>()  // csId → visitIds

  for (const occ of occurrences) {
    const visitId = occ.source_ref_id as string
    const csId    = occ.canonical_subject_id as string

    if (!visitToCS.has(visitId)) visitToCS.set(visitId, new Map())
    const visitMap = visitToCS.get(visitId)!
    if (!visitMap.has(csId)) {
      visitMap.set(csId, {
        occurrenceId:  occ.id as string,
        label:         occ.label as string,
        note:          occ.note as string | null,
        effectiveDate: (occ.effective_date as string)?.slice(0, 10) ?? '?',
        proposalId:    occ.source_proposal_id as string | null,
      })
    }

    if (!csVisitSet.has(csId)) csVisitSet.set(csId, new Set())
    csVisitSet.get(csId)!.add(visitId)
  }

  const N = visitToCS.size   // nombre total de visites/réunions
  if (N < CFG.minCooccurrences) return result

  // Filtre incrémental : sujets présents dans la visite déclenchante
  const subjectsInTriggerVisit = triggerVisitId
    ? new Set([...(visitToCS.get(triggerVisitId) ?? new Map()).keys()])
    : null

  // 4. Co-occurrences par paire
  const pairVisits = new Map<string, Set<string>>()  // pairKey → visitIds
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

  // 5. Liens existants → exclusion
  const { data: existingLinks } = await admin
    .from('canonical_subject_links')
    .select('source_subject_id, target_subject_id, status')
    .eq('site_id', siteId)
  const excludedPairs = new Set<string>()
  for (const lk of existingLinks ?? []) {
    excludedPairs.add(pairKey(lk.source_subject_id, lk.target_subject_id))
  }

  // 6. Pool de candidats filtré
  const candidates: {
    key: string; a: string; b: string
    countA: number; countB: number; countAB: number
    lift: number; confAB: number; confBA: number; combined: number
  }[] = []

  for (const [key, visitSet] of pairVisits) {
    const countAB = visitSet.size
    if (countAB < CFG.minCooccurrences) continue
    if (excludedPairs.has(key)) continue

    const [a, b] = key.split('|')
    if (!csLabel.has(a) || !csLabel.has(b)) continue

    // Filtre incrémental : si triggerVisitId, au moins un sujet doit y être présent
    if (subjectsInTriggerVisit && !subjectsInTriggerVisit.has(a) && !subjectsInTriggerVisit.has(b)) continue

    const countA = csVisitSet.get(a)?.size ?? 0
    const countB = csVisitSet.get(b)?.size ?? 0
    if (countA === 0 || countB === 0) continue

    const lift = (countAB * N) / (countA * countB)
    if (lift < CFG.minLift) continue

    candidates.push({
      key, a, b, countA, countB, countAB,
      lift, confAB: countAB / countA, confBA: countAB / countB,
      combined: lift * (countAB / N),
    })
  }

  const top = candidates
    .sort((x, y) => y.combined - x.combined || y.lift - x.lift)
    .slice(0, CFG.maxCandidatesPerRun)

  // 7. Guard + Gemini + écriture
  for (const p of top) {
    result.candidatesEvaluated++

    const labelA = csLabel.get(p.a) ?? p.a
    const labelB = csLabel.get(p.b) ?? p.b

    // Construit les preuves : une entrée par visite commune, avec les textes des deux sujets
    const commonVisits = [...(pairVisits.get(p.key) ?? [])]

    // Structure enrichie pour l'écriture de link_evidence
    const evidenceWithOccurrences: Array<{
      pairEvidence:    PairEvidence
      occurrenceIdA:   string
      occurrenceIdB:   string
      proposalIdA:     string | null
      proposalIdB:     string | null
    }> = []

    for (const visitId of commonVisits) {
      const visitMap = visitToCS.get(visitId)
      if (!visitMap) continue
      const occA = visitMap.get(p.a)
      const occB = visitMap.get(p.b)
      if (!occA || !occB) continue

      const excerptA = occA.note ?? occA.label
      const excerptB = occB.note ?? occB.label

      evidenceWithOccurrences.push({
        pairEvidence: {
          runId:        visitId,
          runDate:      occA.effectiveDate,
          excerptA,
          excerptB,
          proposalIdA:  occA.proposalId ?? '',
          proposalIdB:  occB.proposalId ?? '',
        },
        occurrenceIdA: occA.occurrenceId,
        occurrenceIdB: occB.occurrenceId,
        proposalIdA:   occA.proposalId,
        proposalIdB:   occB.proposalId,
      })
    }

    // Evidence mandatory : au moins un extrait non-vide
    const validEvidence = evidenceWithOccurrences.filter(e =>
      e.pairEvidence.excerptA.trim() || e.pairEvidence.excerptB.trim()
    )
    if (validEvidence.length === 0) {
      result.skippedNoEvidence++
      continue
    }

    const evidenceForLLM = validEvidence
      .slice(0, 4)
      .map(e => e.pairEvidence)

    // Guard same_subject
    const excerptPairs = evidenceForLLM.map(e => ({ excerptA: e.excerptA, excerptB: e.excerptB }))
    const guardScore = sameSubjectScore(labelA, labelB, p.countA, p.countB, p.countAB, excerptPairs)
    if (guardScore >= 3) {
      result.sameSubjectDetected++
      console.log(`[relations/occ] possible_same_subject: "${labelA}" / "${labelB}" (score ${guardScore}/5)`)
      continue
    }

    const pair: CandidatePair = {
      csIdA: p.a, labelA, famA: 'observation',
      csIdB: p.b, labelB, famB: 'observation',
      countA: p.countA, countB: p.countB, countAB: p.countAB, N,
      lift: p.lift, confAB: p.confAB, confBA: p.confBA,
      evidence: evidenceForLLM,
    }

    let qualResult
    try {
      qualResult = await qualifyLinkCandidate(pair)
    } catch {
      result.errors++
      continue
    }

    if (!qualResult || qualResult.linkType === 'no_relation') {
      result.noRelation++
      continue
    }

    const { linkType, direction, confidence, justification, evidenceRunIds } = qualResult

    // Whitelist serveur P0-B1 : relates_to rejeté avant tout INSERT
    if (!ALLOWED_RELATION_TYPES.has(linkType)) {
      result.relatesTo++
      console.log(`[relations/occ] rejected(${linkType}): "${labelA}" ↔ "${labelB}" (whitelist)`)
      continue
    }

    result.directional++

    if (confidence < CFG.minLlmConfidence) {
      result.skippedLowConf++
      continue
    }

    // Direction → source/target
    let sourceSubjectId: string, targetSubjectId: string
    if (direction === 'A_to_B')      { sourceSubjectId = p.a; targetSubjectId = p.b }
    else if (direction === 'B_to_A') { sourceSubjectId = p.b; targetSubjectId = p.a }
    else                             { sourceSubjectId = p.a < p.b ? p.a : p.b; targetSubjectId = p.a < p.b ? p.b : p.a }

    if (dryRun) {
      console.log(`[relations/occ/dry] ${linkType} ${direction} conf=${confidence.toFixed(2)} "${labelA}" → "${labelB}"`)
      console.log(`  justification: ${justification.slice(0, 150)}`)
      console.log(`  evidence: ${validEvidence.length} occurrence(s)`)
      result.written++
      continue
    }

    // INSERT canonical_subject_links
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
      .select('id')
      .single()

    if (linkError) {
      if (linkError.code === '23505') {
        // Doublon sur paire normalisée — idempotent
        console.log(`[relations/occ] duplicate pair skipped: "${labelA}" ↔ "${labelB}"`)
      } else {
        console.error(`[relations/occ] insert error: ${linkError.message}`)
        result.errors++
      }
      continue
    }

    const linkId = insertedLink.id as string

    // INSERT canonical_subject_link_evidence (une ligne par occurrence commune)
    const evidenceToWrite = validEvidence.slice(0, 4).flatMap(e => {
      const entries: object[] = []
      if (e.pairEvidence.excerptA.trim()) {
        entries.push({
          link_id:           linkId,
          occurrence_id:     e.occurrenceIdA,
          evidence_text:     e.pairEvidence.excerptA.slice(0, 500),
          observed_at:       e.pairEvidence.runDate,
          source_proposal_id: e.proposalIdA ?? null,
        })
      }
      if (e.pairEvidence.excerptB.trim()) {
        entries.push({
          link_id:           linkId,
          occurrence_id:     e.occurrenceIdB,
          evidence_text:     e.pairEvidence.excerptB.slice(0, 500),
          observed_at:       e.pairEvidence.runDate,
          source_proposal_id: e.proposalIdB ?? null,
        })
      }
      return entries
    })

    if (evidenceToWrite.length > 0) {
      const { error: evErr } = await admin
        .from('canonical_subject_link_evidence')
        .insert(evidenceToWrite)
      if (evErr) {
        console.error(`[relations/occ] evidence insert error: ${evErr.message}`)
      }
    }

    result.written++
    console.log(`[relations/occ] suggested: ${linkType} conf=${confidence.toFixed(2)} "${labelA}" → "${labelB}"`)
  }

  return result
}
