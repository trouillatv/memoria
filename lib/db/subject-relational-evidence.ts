import 'server-only'

// V2 Option C — capture de la PREUVE RELATIONNELLE (phrase source) au fil du pipeline visite.
//
// Contrat (Vincent) :
//   - NE crée AUCUNE relation métier (pas de canonical_subject_links, pas d'appel au juge).
//   - Conserve la phrase source (verbatim, sans reformulation LLM) rattachée aux canonical_subjects
//     qu'elle MENTIONNE réellement (0..N). On ne fabrique JAMAIS de subject_ids pour atteindre 2 sujets.
//   - N'utilise QUE la matière déjà produite (debrief.summary + actions.rationale + propositions),
//     aucune nouvelle extraction LLM.
//   - Occurrences canoniques INCHANGÉES (B2 atomicité préservée).
//   - Idempotent : rejouer une visite ne duplique pas la preuve (UNIQUE(source_ref_id, evidence_hash)).
//
// La détection déterministe (marqueurs + appariement par tokens de label) est identique à celle
// prouvée par le dry-run de spec (`scripts/audit-v2-temoins.ts`) : 21/21 conservées, mis-attribution = 0.

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Détection déterministe (partagée avec les scripts d'audit) ────────────────

const REL_MARKER =
  /(d[ée]pend|n[ée]cessite|impossible (?:de |tant)|tant qu[e']|avant (?:de |la |le |d')|apr[eè]s (?:validation|la |le |l')|une fois que|conditionn[ée]|pr[ée]alable|bloqu|emp[êe]ch|permet(?:tra|tre|)? (?:de|le|la)|ne peut(?:vent)? pas|ne pourra|en attente (?:de|d')|requiert|doit être (?:termin|fait|valid|fini)|en remplacement|remplac|suite à|sous r[ée]serve)/i

const STOP = new Set([
  'dans', 'pour', 'avec', 'sans', 'sous', 'les', 'des', 'une', 'due', 'sur', 'aux', 'par',
  'est', 'sont', 'sera', 'entre', 'leur', 'cette', 'chantier', 'general', 'générale', 'travaux',
])

const MAX_EVIDENCE_CHARS = 500

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function distinctiveTokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length >= 5 && !STOP.has(t))
}
function splitSentences(txt: string): string[] {
  return txt.split(/(?<=[.!?;\n])\s+/).map((s) => s.trim()).filter((s) => s.length > 12)
}

// ── Fonction PURE (exportée pour les tests) ───────────────────────────────────

export interface RelSubject { id: string; label: string }
export interface RelSource { text: string; sourceProposalId?: string | null }
export interface RelEvidence { evidenceText: string; subjectIds: string[]; sourceProposalId: string | null }

/**
 * Extrait les preuves relationnelles d'un ensemble de textes source (debrief/propositions),
 * chacune rattachée aux canonical_subjects réellement MENTIONNÉS. Déterministe, sans LLM.
 * Ne conserve QUE les phrases mentionnant ≥ 1 sujet (contrat : une preuve sans sujet rattachable
 * n'est pas persistée ici). Dédupe par phrase normalisée.
 */
export function extractRelationalEvidence(sources: RelSource[], subjects: RelSubject[]): RelEvidence[] {
  const subjTokens = subjects.map((s) => ({ id: s.id, tokens: new Set(distinctiveTokens(s.label)) }))
  const out: RelEvidence[] = []
  const seen = new Set<string>()

  for (const src of sources) {
    if (!src.text) continue
    for (const sentence of splitSentences(src.text)) {
      if (!REL_MARKER.test(sentence)) continue
      const key = normalize(sentence).slice(0, 100)
      if (seen.has(key)) continue
      seen.add(key)

      const sentTokens = new Set(distinctiveTokens(sentence))
      const subjectIds = subjTokens
        .filter((s) => s.tokens.size > 0 && [...s.tokens].some((t) => sentTokens.has(t)))
        .map((s) => s.id)

      if (subjectIds.length === 0) continue // contrat : ≥1 sujet rattachable, sinon non persistée
      out.push({
        evidenceText: sentence.slice(0, MAX_EVIDENCE_CHARS),
        subjectIds: [...new Set(subjectIds)],
        sourceProposalId: src.sourceProposalId ?? null,
      })
    }
  }
  return out
}

// ── Persistance (best-effort, idempotente) ────────────────────────────────────

export interface CaptureResult {
  candidates: number      // phrases relationnelles rencontrées (≥1 sujet)
  persisted: number       // insérées (nouvelles)
  duplicatesIgnored: number
  avgSubjectsPerEvidence: number
  errors: number
}

/**
 * Capture les preuves relationnelles d'un report APRÈS réconciliation proposition→canonical_subject.
 * Best-effort : ne bloque jamais le pipeline. Idempotent (onConflict source_ref_id,evidence_hash).
 * Ne touche JAMAIS canonical_subject_occurrence.
 */
export async function captureRelationalEvidenceForReport(opts: {
  admin: SupabaseClient
  siteId: string
  reportId: string
  sourceKind: 'field_visit' | 'meeting' | 'historical_pdf'
}): Promise<CaptureResult> {
  const { admin, siteId, reportId, sourceKind } = opts
  const empty: CaptureResult = { candidates: 0, persisted: 0, duplicatesIgnored: 0, avgSubjectsPerEvidence: 0, errors: 0 }

  // 1. Sujets candidats = ceux PRÉSENTS DANS CE REPORT (les sujets de la visite), acteurs exclus.
  //    On restreint volontairement aux sujets du report (et non à tout le site) : une phrase de
  //    cette visite ne doit être rattachée qu'aux sujets qu'elle concerne, jamais à un sujet
  //    homonyme d'une autre visite → évite la sur-attribution (mis-attribution).
  const { data: repOcc } = await admin
    .from('canonical_subject_occurrence').select('canonical_subject_id').eq('source_ref_id', reportId)
  const reportSubjectIds = new Set((repOcc ?? []).map((o) => (o as Record<string, unknown>).canonical_subject_id as string))
  if (reportSubjectIds.size === 0) return empty

  const { data: cs } = await admin
    .from('canonical_subject').select('id, label, company_id, contact_id')
    .eq('site_id', siteId).eq('status', 'active')
  const subjects: RelSubject[] = (cs ?? [])
    .filter((c) => {
      const r = c as Record<string, unknown>
      return reportSubjectIds.has(r.id as string) && !r.company_id && !r.contact_id
    })
    .map((c) => ({ id: (c as Record<string, unknown>).id as string, label: (c as Record<string, unknown>).label as string }))
  if (subjects.length === 0) return empty

  // 2. Matière déjà produite : debrief (summary + rationale) + propositions (title/body).
  const { data: rep } = await admin.from('site_reports').select('debrief_analysis').eq('id', reportId).maybeSingle()
  const da = ((rep as { debrief_analysis: Record<string, unknown> | null } | null)?.debrief_analysis ?? {}) as Record<string, unknown>
  const { data: props } = await admin
    .from('site_knowledge_proposals').select('id, title, body').eq('report_id', reportId)

  const sources: RelSource[] = [
    { text: String(da.summary ?? ''), sourceProposalId: null },
    ...((da.actions as Array<Record<string, unknown>> ?? []).map((a) => ({ text: String(a.rationale ?? ''), sourceProposalId: null }))),
    ...((props ?? []) as Array<Record<string, unknown>>).map((p) => ({
      text: `${p.title ?? ''}. ${p.body ?? ''}`,
      sourceProposalId: p.id as string,
    })),
  ]

  const evidences = extractRelationalEvidence(sources, subjects)
  if (evidences.length === 0) return empty

  // 3. Upsert idempotent — ignoreDuplicates sur (source_ref_id, evidence_hash).
  let persisted = 0, duplicatesIgnored = 0, errors = 0, subjectSum = 0
  for (const e of evidences) {
    subjectSum += e.subjectIds.length
    const { data, error } = await admin
      .from('subject_relational_evidence')
      .upsert({
        site_id: siteId,
        source_kind: sourceKind,
        source_ref_id: reportId,
        source_proposal_id: e.sourceProposalId,
        evidence_text: e.evidenceText,
        subject_ids: e.subjectIds,
      }, { onConflict: 'source_ref_id,evidence_hash', ignoreDuplicates: true })
      .select('id')
    if (error) { errors++; continue }
    if (data && data.length > 0) persisted++
    else duplicatesIgnored++
  }

  return {
    candidates: evidences.length,
    persisted,
    duplicatesIgnored,
    avgSubjectsPerEvidence: evidences.length ? Number((subjectSum / evidences.length).toFixed(2)) : 0,
    errors,
  }
}
