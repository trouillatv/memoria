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
  getLatestExtractionRunForDocumentAndExtractor,
  READY_STATUSES,
} from '@/lib/db/document-extractions'
import {
  runEngagementCandidateExtractionAgent,
  type ExtractedEngagementCandidate,
} from '@/services/ai/engagement-prescriptif-extraction'
import { ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1 } from '@/services/ai/prompts/engagement-extractor-prescriptif.v1'
import { buildPageWindows } from '@/lib/documents/page-windows'
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
// Source unique : ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1.version
// (services/ai/prompts/engagement-extractor-prescriptif.v1.ts). Le même champ
// alimente aussi metadata.prompt_version (services/ai/engagement-prescriptif-
// extraction.ts) — ne JAMAIS dupliquer cette valeur dans une constante propre,
// pour qu'un bump de version ne puisse jamais diverger entre le run persisté
// et les métadonnées.
const EXTRACTOR_VERSION = ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1.version
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

  // 5. Idempotence : SCOPÉE à ce seul extractor_key. Un document peut être
  // traité par plusieurs profils d'extraction (ex. historical_pv) — un run
  // d'un autre profil ne doit jamais bloquer ni faire réutiliser celui-ci.
  // Une nouvelle version du profil (EXTRACTOR_VERSION) ne réutilise jamais un
  // run READY d'une version antérieure : elle relance une extraction propre.
  const existing = await getLatestExtractionRunForDocumentAndExtractor(documentId, EXTRACTOR_KEY)
  if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
    return { ok: false, error: 'Extraction déjà en cours', runId: existing.id }
  }
  if (
    existing &&
    !opts.force &&
    existing.extractor_version === EXTRACTOR_VERSION &&
    READY_STATUSES.has(existing.status)
  ) {
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

    // 7. Extraction LLM des candidats prescriptifs, fenêtre de pages par
    // fenêtre de pages (lib/documents/page-windows.ts). Un CCTP qui tient
    // sous le budget d'une fenêtre produit une fenêtre unique — comportement
    // inchangé pour les documents courts. Le plafond de clauses n'est jamais
    // global au document (cf. prompt v1) : chaque fenêtre est lue en entier.
    await updateExtractionStage(runId, 'extracting_engagements')
    const windows = buildPageWindows(text)
    log('windows_built', documentId, { runId, windowCount: windows.length })

    const allCandidates: ExtractedEngagementCandidate[] = []
    let provider: unknown
    for (const w of windows) {
      const baseLabel = d.storage_path.split('/').pop() ?? documentId
      const sourceLabel = windows.length > 1
        ? `${baseLabel} (pages ${w.pages[0]}-${w.pages[w.pages.length - 1]})`
        : baseLabel
      const { candidates, metadata } = await runEngagementCandidateExtractionAgent({
        sourceText: w.text,
        sourceLabel,
        userId,
      })
      provider = provider ?? metadata.provider
      log('window_candidates_extracted', documentId, {
        runId, windowIndex: w.index, pages: w.pages, count: candidates.length,
      })
      allCandidates.push(...candidates)
    }
    log('candidates_extracted', documentId, { runId, count: allCandidates.length, provider, windowCount: windows.length })

    // 8. Grounding : la page n'est JAMAIS celle devinée par le modèle — elle
    // est retrouvée mécaniquement à partir du marqueur [[page N]] qui précède
    // l'extrait verbatim dans le texte source COMPLET (même principe que
    // Porte A, cf. lib/tenders/engagement-provenance.ts) — la découpe en
    // fenêtres ne change que ce qui est soumis au modèle, jamais la base du
    // grounding. Un extrait introuvable verbatim n'est pas une preuve
    // exploitable : le candidat est écarté.
    const groundedInputs = allCandidates.flatMap((c) => {
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

    // 8bis. Déduplication déterministe : une clause présente dans le
    // recouvrement de deux fenêtres adjacentes ne doit produire qu'UNE seule
    // proposition. Clé = page mécaniquement retrouvée + extrait normalisé —
    // provenance réelle, jamais de réconciliation LLM. Deux clauses
    // différentes mais proches restent deux propositions distinctes tant que
    // leur extrait normalisé diffère.
    const seenDedupKeys = new Set<string>()
    const proposalInputs = groundedInputs.filter((p) => {
      const key = `${p.source_page ?? 'null'}::${normalizeForMatch(p.source_excerpt)}`
      if (seenDedupKeys.has(key)) {
        log('candidate_dropped_duplicate_window_overlap', documentId, {
          runId, label: p.label, source_page: p.source_page,
        })
        return false
      }
      seenDedupKeys.add(key)
      return true
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
