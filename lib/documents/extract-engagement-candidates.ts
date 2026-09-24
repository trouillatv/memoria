import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractPdfText, extractWithGeminiOCR } from '@/services/pdf/extract'
import { locateQuote } from '@/services/ai/source-validation'
import {
  createExtractionRun,
  updateExtractionRunStatus,
  updateExtractionStage,
  insertExtractionProposals,
  insertExtractionEvidence,
  linkProposalEvidence,
  getLatestExtractionRunForDocument,
  READY_STATUSES,
} from '@/lib/db/document-extractions'
import { runEngagementCandidateExtractionAgent } from '@/services/ai/engagement-prescriptif-extraction'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import type { DocumentExtractionEmptyReason } from '@/types/db'

// P0-2B — Extracteur prescriptif de candidats Engagements (Porte B).
//
// Un document CONTRACTUEL déjà rattaché à un chantier (CCTP/CCAP/contrat/
// avenant/ordre de service) produit des document_extraction_proposal
// (proposal_family='engagement'). Rien d'autre : pas de matérialisation, pas
// d'Action, pas de site_obligation, pas d'UI — cf. mandat P0-2B.
//
// Orchestrateur volontairement plus simple que extractHistoricalPv (lib/documents/
// extract-historical-pv.ts) : pas de photos, pas de réconciliation de sujets,
// pas d'embeddings — aucun de ces mécanismes n'a de sens pour un extrait
// prescriptif de clause contractuelle.

const EXTRACTOR_KEY = 'engagement_prescriptif_v1'
const EXTRACTOR_VERSION = '1.0.0'
const MIN_USABLE_CHARS = 100

// Chaîne exacte du mandat : "document contractuel" → "extracteur prescriptif".
const ELIGIBLE_DOCUMENT_TYPES = new Set(['cctp', 'ccap', 'contrat', 'avenant', 'ordre_service'])

export type ExtractEngagementCandidatesResult =
  | { ok: true; runId: string; reused: boolean; proposalCount: number }
  | { ok: false; error: string; runId?: string }

class OcrFailureError extends Error {
  constructor(msg: string) { super(msg); this.name = 'OcrFailureError' }
}

function classifyExtractionError(e: unknown): DocumentExtractionEmptyReason {
  if (e instanceof OcrFailureError) return 'OCR_FAILURE'
  return 'TECHNICAL_FAILURE'
}

function log(event: string, documentId: string, extra?: Record<string, unknown>) {
  console.error(
    JSON.stringify({ service: 'extractEngagementCandidates', event, documentId, ...extra, ts: new Date().toISOString() }),
  )
}

function normalizeForMatch(s: string): string {
  return s.replace(/\s+/gu, ' ').trim().toLowerCase()
}

export async function extractEngagementCandidates(
  documentId: string,
  userId: string,
  opts: { force?: boolean } = {},
): Promise<ExtractEngagementCandidatesResult> {
  const supabase = createAdminClient()

  // 1. Vérifier le document et son éligibilité de type.
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('id, storage_path, organization_id, document_type')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (docErr || !doc) {
    return { ok: false, error: 'Document introuvable' }
  }
  const d = doc as { id: string; storage_path: string; organization_id: string; document_type: string }

  if (!ELIGIBLE_DOCUMENT_TYPES.has(d.document_type)) {
    return { ok: false, error: `Type de document non éligible pour l'extraction d'engagements : ${d.document_type}` }
  }

  // 2. Garde d'organisation STRICTE — relit l'appartenance en base pour CET
  // utilisateur, jamais un rôle global mémorisé (lib/auth/memberships.ts).
  const membership = await requireOrganizationMembership(d.organization_id, { id: userId })
  if (!membership.ok) {
    return { ok: false, error: membership.error }
  }

  // 3. Résolution du chantier cible via document_links. Porte B exige
  // target_site_id NOT NULL à la matérialisation (mig 436) : un document
  // contractuel non rattaché à un chantier ne peut produire aucun candidat.
  const { data: link } = await supabase
    .from('document_links')
    .select('target_id')
    .eq('document_id', documentId)
    .eq('target_type', 'site')
    .maybeSingle()
  const siteId = (link as { target_id: string } | null)?.target_id ?? null
  if (!siteId) {
    return { ok: false, error: "Document non rattaché à un chantier — extraction d'engagements impossible" }
  }

  // 4. Cohérence org document ↔ chantier : un rattachement cross-org ne doit
  // jamais produire un candidat rattachable à un chantier d'une autre organisation.
  const { data: site } = await supabase
    .from('sites')
    .select('id, organization_id')
    .eq('id', siteId)
    .maybeSingle()
  if (!site || (site as { organization_id: string }).organization_id !== d.organization_id) {
    return { ok: false, error: 'Chantier cible hors organisation du document — rattachement refusé' }
  }

  // 5. Idempotence : pas deux extractions en vol sur le même document, et
  // réutilisation d'un run déjà exploitable sauf intention explicite (force).
  const existing = await getLatestExtractionRunForDocument(documentId)
  if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
    return { ok: false, error: 'Extraction déjà en cours', runId: existing.id }
  }
  if (existing && !opts.force && READY_STATUSES.has(existing.status)) {
    return { ok: true, runId: existing.id, reused: true, proposalCount: 0 }
  }

  const runId = await createExtractionRun({
    document_id: documentId,
    organization_id: d.organization_id,
    extractor_key: EXTRACTOR_KEY,
    extractor_version: EXTRACTOR_VERSION,
    target_site_id: siteId,
    created_by: userId,
  })

  try {
    log('extraction_start', documentId, { runId })
    await updateExtractionRunStatus(runId, 'processing', { started_at: new Date().toISOString() })
    await updateExtractionStage(runId, 'downloading')

    const { data: blob, error: dlErr } = await supabase.storage.from('documents').download(d.storage_path)
    if (dlErr || !blob) throw new Error(`download: ${dlErr?.message ?? 'no_blob'}`)
    const buffer = Buffer.from(await blob.arrayBuffer())

    // 6. Extraction texte native, OCR si scanné — même seuil que extractHistoricalPv.
    await updateExtractionStage(runId, 'extracting_text')
    let extracted = await extractPdfText(buffer)
    let text = extracted.text
    if (extracted.isLikelyScanned || extracted.charCount < MIN_USABLE_CHARS) {
      if (process.env.GOOGLE_GENAI_API_KEY) {
        try {
          const ocrText = await extractWithGeminiOCR(buffer)
          if (ocrText && ocrText.trim().length >= MIN_USABLE_CHARS) {
            text = ocrText.trim()
            extracted = { ...extracted, text }
          }
        } catch (e) {
          log('ocr_failed', documentId, { error: e instanceof Error ? e.message : String(e) })
        }
      }
    }
    if (text.trim().length < MIN_USABLE_CHARS) throw new OcrFailureError('no_extractable_text')
    const extractedTextLength = text.length
    log('text_extracted', documentId, { runId, chars: extractedTextLength })

    // 7. Extraction LLM des candidats prescriptifs.
    await updateExtractionStage(runId, 'extracting_engagements')
    const { candidates, metadata } = await runEngagementCandidateExtractionAgent({
      sourceText: text,
      sourceLabel: d.storage_path.split('/').pop() ?? documentId,
      userId,
    })
    log('candidates_extracted', documentId, { runId, count: candidates.length, provider: metadata.provider })

    // 8. Grounding : la page n'est JAMAIS celle devinée par le modèle — elle
    // est retrouvée mécaniquement à partir du marqueur [[page N]] qui précède
    // l'extrait verbatim dans le texte source (même principe que Porte A,
    // cf. lib/tenders/engagement-provenance.ts). Un extrait introuvable
    // verbatim n'est pas une preuve exploitable : le candidat est écarté.
    const proposalInputs = candidates.flatMap((c) => {
      const needle = normalizeForMatch(c.sourceExcerpt)
      if (!normalizeForMatch(text).includes(needle)) {
        log('candidate_dropped_unverifiable_excerpt', documentId, { runId, label: c.label })
        return []
      }
      const located = locateQuote(text, needle)
      return [{
        organization_id: d.organization_id,
        document_id: documentId,
        target_site_id: siteId,
        proposal_family: 'engagement' as const,
        label: c.label,
        description: c.description,
        source_page: located.page ?? null,
        source_excerpt: c.sourceExcerpt,
        source_payload: {
          kind: c.kind,
          category: c.categorySuggestion,
          measurable: c.measurable,
          frequency_raw: c.frequencyRaw,
          ai_confidence: c.aiConfidence,
        },
      }]
    })

    let proposalCount = 0
    if (proposalInputs.length > 0) {
      const proposalIds = await insertExtractionProposals(runId, proposalInputs)
      proposalCount = proposalIds.length

      // Preuve obligatoire : chaque proposal reçoit une evidence text_excerpt
      // sur SON propre extrait — condition vérifiée en base à la matérialisation
      // (mig 436 : "aucune preuve (evidence) liée, création refusée").
      const evidenceInputs = proposalInputs.map((p) => ({
        organization_id: d.organization_id,
        document_id: documentId,
        evidence_type: 'text_excerpt' as const,
        source_page: p.source_page,
        nearby_text: p.source_excerpt,
      }))
      const evidenceResults = await insertExtractionEvidence(runId, evidenceInputs)
      for (let i = 0; i < proposalIds.length; i++) {
        await linkProposalEvidence(proposalIds[i]!, evidenceResults[i]!.id, 'supports')
      }
    }

    const emptyReason: DocumentExtractionEmptyReason | null =
      proposalCount === 0 ? 'NO_BUSINESS_ELEMENT_DETECTED' : null

    await updateExtractionRunStatus(runId, 'ready_for_review', {
      completed_at: new Date().toISOString(),
      extracted_text_length: extractedTextLength,
      empty_reason: emptyReason,
    })

    log('extraction_done', documentId, { runId, proposalCount })
    return { ok: true, runId, reused: false, proposalCount }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const reason = classifyExtractionError(e)
    log('extraction_failed', documentId, { runId, error: msg, empty_reason: reason })
    await updateExtractionRunStatus(runId, 'failed', {
      error_message: msg,
      completed_at: new Date().toISOString(),
      empty_reason: reason,
    }).catch((updateErr) => {
      console.error('[extractEngagementCandidates] failed to mark run as failed:', updateErr)
    })
    return { ok: false, error: msg, runId }
  }
}
