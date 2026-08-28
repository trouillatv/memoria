import 'server-only'

// V3 — voie explicite : produit des relations SUGGÉRÉES à partir des preuves relationnelles V2
// (subject_relational_evidence) portant ≥2 canonical_subjects. 2e voie d'acquisition,
// COMPLÉMENTAIRE de la voie cooccurrence PV/CR — jamais un remplacement.
//
// Chaîne : subject_relational_evidence (≥2 sujets) → paires bornées → MÊME juge durci
//   (qualifyLinkCandidate) → MÊME whitelist serveur → canonical_subject_links status='suggested'
//   + canonical_subject_link_evidence (evidence_text = la phrase source ; provenance).
//
// Invariants : acteurs exclus ; preuve obligatoire ; ≥2 canonical_subjects réels ; relates_to jamais
//   persisté ; jamais 'confirmed' automatiquement ; idempotent (contrainte de paire + exclusion des
//   paires existantes) ; coût borné ; best-effort (ne bloque jamais la visite).

import type { SupabaseClient } from '@supabase/supabase-js'
import { RELATION_CANDIDATE_CONFIG as CFG } from './relation-producer-config'
import { qualifyLinkCandidate, type CandidatePair } from './qualify-link-candidates'
import { getActorCanonicalIds } from '@/lib/documents/occurrence-population'
import { todayLocalIso } from '@/lib/time/local-date'

const ALLOWED = new Set(['requires', 'enables', 'validates', 'causes', 'replaces'])
const MAX_SUBJECTS_PER_EVIDENCE = 4 // au-delà = sur-appariement probable → on n'énumère pas

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }

// ── Helper PUR (exporté pour tests) ───────────────────────────────────────────

export interface EvidenceRow { id: string; evidenceText: string; subjectIds: string[]; sourceProposalId: string | null }
export interface EvidencePair { a: string; b: string; evidenceText: string; sourceProposalId: string | null; evidenceId: string }

/**
 * Transforme des preuves (≥2 sujets) en paires candidates BORNÉES et dédupliquées.
 * Ignore les preuves à 0/1 sujet et celles à > MAX_SUBJECTS_PER_EVIDENCE (sur-appariement).
 * Dédup par paire au niveau du report (1 tentative par paire ; la 1re preuve rencontrée est portée).
 */
export function buildEvidencePairs(evidences: EvidenceRow[]): EvidencePair[] {
  const seen = new Set<string>()
  const out: EvidencePair[] = []
  for (const e of evidences) {
    const ids = [...new Set(e.subjectIds)]
    if (ids.length < 2 || ids.length > MAX_SUBJECTS_PER_EVIDENCE) continue
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = pairKey(ids[i], ids[j])
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ a: ids[i], b: ids[j], evidenceText: e.evidenceText, sourceProposalId: e.sourceProposalId, evidenceId: e.id })
    }
  }
  return out
}

// ── Producteur (best-effort, idempotent) ──────────────────────────────────────

export interface V3Result {
  evidences: number          // preuves V2 du report
  evidencesMultiSubject: number
  pairs: number              // paires candidates après bornage/dédup
  pairsExisting: number      // paires déjà en base (skip avant juge)
  llmCalls: number
  noRelation: number
  relatesToRejected: number
  written: number            // suggested créées
  duplicates: number         // 23505 idempotence
  errors: number
}

export async function produceRelationsFromExplicitEvidence(opts: {
  admin: SupabaseClient
  siteId: string
  reportId: string
}): Promise<V3Result> {
  const { admin, siteId, reportId } = opts
  const r: V3Result = {
    evidences: 0, evidencesMultiSubject: 0, pairs: 0, pairsExisting: 0,
    llmCalls: 0, noRelation: 0, relatesToRejected: 0, written: 0, duplicates: 0, errors: 0,
  }

  // 1. Preuves V2 du report.
  const { data: evRows } = await admin
    .from('subject_relational_evidence')
    .select('id, evidence_text, subject_ids, source_proposal_id')
    .eq('source_ref_id', reportId)
  const evidences: EvidenceRow[] = (evRows ?? []).map((e) => ({
    id: (e as Record<string, unknown>).id as string,
    evidenceText: (e as Record<string, unknown>).evidence_text as string,
    subjectIds: ((e as Record<string, unknown>).subject_ids as string[]) ?? [],
    sourceProposalId: ((e as Record<string, unknown>).source_proposal_id as string | null) ?? null,
  }))
  r.evidences = evidences.length
  r.evidencesMultiSubject = evidences.filter((e) => e.subjectIds.length >= 2).length
  if (r.evidencesMultiSubject === 0) return r

  // 2. Garde acteurs + labels canoniques valides du site.
  const actorCs = await getActorCanonicalIds(siteId)
  const { data: cs } = await admin.from('canonical_subject').select('id, label, status').eq('site_id', siteId).eq('status', 'active')
  const label = new Map((cs ?? []).map((c) => [(c as Record<string, unknown>).id as string, (c as Record<string, unknown>).label as string]))

  // 3. Paires existantes (toute paire déjà en base : confirmed/suggested/rejected → on n'y retouche pas).
  const { data: existing } = await admin.from('canonical_subject_links').select('source_subject_id, target_subject_id').eq('site_id', siteId)
  const excluded = new Set<string>((existing ?? []).map((l) => pairKey((l as Record<string, unknown>).source_subject_id as string, (l as Record<string, unknown>).target_subject_id as string)))

  // 4. Paires candidates bornées.
  const pairs = buildEvidencePairs(evidences).filter((p) => {
    if (actorCs.has(p.a) || actorCs.has(p.b)) return false       // acteurs exclus (double garde)
    if (!label.has(p.a) || !label.has(p.b)) return false          // sujets réels du site
    if (excluded.has(pairKey(p.a, p.b))) { r.pairsExisting++; return false }
    return true
  })
  r.pairs = pairs.length
  if (pairs.length === 0) return r

  // 5. Juge durci → whitelist → écriture suggested + preuve.
  for (const p of pairs) {
    const labelA = label.get(p.a)!, labelB = label.get(p.b)!
    const candidate: CandidatePair = {
      csIdA: p.a, labelA, famA: 'observation',
      csIdB: p.b, labelB, famB: 'observation',
      countA: 1, countB: 1, countAB: 1, N: 1, lift: 1.0, confAB: 1.0, confBA: 1.0,
      evidence: [{ runId: reportId, runDate: '', excerptA: p.evidenceText, excerptB: p.evidenceText, proposalIdA: '', proposalIdB: '' }],
    }
    r.llmCalls++
    let q
    try { q = await qualifyLinkCandidate(candidate) } catch { r.errors++; continue }
    if (!q || q.linkType === 'no_relation') { r.noRelation++; continue }
    if (!ALLOWED.has(q.linkType)) { r.relatesToRejected++; continue }         // relates_to jamais persisté
    if (q.confidence < CFG.minLlmConfidence) { r.noRelation++; continue }

    const source = q.direction === 'B_to_A' ? p.b : p.a
    const target = q.direction === 'B_to_A' ? p.a : p.b

    const { data: link, error: linkErr } = await admin
      .from('canonical_subject_links')
      .insert({
        site_id: siteId,
        source_subject_id: source,
        target_subject_id: target,
        relation_type: q.linkType,
        status: 'suggested',                 // JAMAIS confirmed automatiquement
        confidence: q.confidence,
        justification: q.justification,
        evidence_run_id: null,
      })
      .select('id').single()

    if (linkErr) {
      if (linkErr.code === '23505') r.duplicates++      // idempotence (paire déjà écrite entre-temps)
      else r.errors++
      continue
    }

    // Preuve verbatim (evidence_text NOT NULL) + provenance proposition V2.
    const { error: evErr } = await admin.from('canonical_subject_link_evidence').insert({
      link_id: (link as { id: string }).id,
      occurrence_id: null,
      evidence_text: p.evidenceText,
      observed_at: todayLocalIso(),
      source_proposal_id: p.sourceProposalId,
    })
    if (evErr) {
      // Invariant P0-B1 : un lien sans preuve ne doit pas rester. Rollback.
      await admin.from('canonical_subject_links').delete().eq('id', (link as { id: string }).id)
      r.errors++
      continue
    }
    r.written++
  }

  return r
}
