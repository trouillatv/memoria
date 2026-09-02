// Sprint 4B.1 — tests extraction structurée PV historiques
//
// Tests couvrant :
//   Section 1 (1-9) : validation Zod des schémas de sortie LLM
//   shouldAutoLinkEvidence : rattachement preuve ↔ proposition par type (GO point 1)
//   Section 3 (10-20) : orchestrateur extractHistoricalPv (mocks complets)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  LlmExtractionResultSchema,
  LlmProposalSchema,
  LlmEvidenceSchema,
} from '../../lib/documents/historical-visit-extractor'

// ─── Hoisted mocks (disponibles avant le hissage des vi.mock) ────────────────

const mocks = vi.hoisted(() => ({
  maybySingle: vi.fn(),
  storageDownload: vi.fn(),
  storageUpload: vi.fn(),
  extractPdfText: vi.fn(),
  extractWithGeminiOCR: vi.fn(),
  renderPdfPage: vi.fn(),
  extractHistoricalPvProposals: vi.fn(),
  createExtractionRun: vi.fn(),
  updateExtractionRunStatus: vi.fn(),
  updateExtractionStage: vi.fn(),
  insertExtractionProposals: vi.fn(),
  insertExtractionEvidence: vi.fn(),
  linkProposalEvidence: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      // Chaîne générique : select/eq/is/update se renvoient eux-mêmes. maybeSingle()
      // résout via le mock partagé (documents / document_links). Le chaînage est aussi
      // thenable pour supporter un `await ...update(...).eq(...)` sans terminal explicite
      // (persistance extracted_text, promotion is_canonical) sans dupliquer le mock par table.
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.is = () => chain
      chain.update = () => chain
      chain.maybySingle = mocks.maybySingle
      chain.maybeSingle = mocks.maybySingle
      chain.then = (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null })
      return chain
    },
    storage: {
      from: () => ({
        download: mocks.storageDownload,
        upload: mocks.storageUpload,
      }),
    },
  }),
}))

vi.mock('@/services/pdf/extract', () => ({
  extractPdfText: mocks.extractPdfText,
  extractWithGeminiOCR: mocks.extractWithGeminiOCR,
}))

vi.mock('@/services/pdf/render-page', () => ({
  renderPdfPage: mocks.renderPdfPage,
}))

vi.mock('../../lib/documents/historical-visit-extractor', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/documents/historical-visit-extractor')>()
  return {
    ...actual,
    extractHistoricalPvProposals: mocks.extractHistoricalPvProposals,
  }
})

vi.mock('@/lib/db/document-extractions', () => ({
  createExtractionRun: mocks.createExtractionRun,
  updateExtractionRunStatus: mocks.updateExtractionRunStatus,
  updateExtractionStage: mocks.updateExtractionStage,
  insertExtractionProposals: mocks.insertExtractionProposals,
  insertExtractionEvidence: mocks.insertExtractionEvidence,
  linkProposalEvidence: mocks.linkProposalEvidence,
}))

// ─── Section 1 : Validation Zod des schémas LLM ──────────────────────────────

describe('LlmExtractionResultSchema — validation Zod', () => {
  it('1. valide un résultat complet avec proposition + preuve', () => {
    const raw = {
      proposals: [{
        temporaryKey: 'res-infiltration-p7',
        family: 'reservation',
        label: 'Infiltration en pied de façade nord',
        description: 'Traces d\'humidité sur 2 ml',
        sourcePage: 7,
        sourceExcerpt: 'traces d\'humidité visibles',
        sourcePayload: { statusAtDocumentDate: 'ouvert', dueDate: null, responsibleParty: null },
        evidenceKeys: ['ev-text-p7'],
      }],
      evidence: [{
        temporaryKey: 'ev-text-p7',
        evidenceType: 'text_excerpt',
        sourcePage: 7,
        text: 'traces d\'humidité visibles sur une longueur de 2 ml',
        caption: null,
        nearbyText: null,
      }],
    }
    const result = LlmExtractionResultSchema.parse(raw)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].family).toBe('reservation')
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0].evidenceType).toBe('text_excerpt')
  })

  it('2. valide un résultat vide (listes vides autorisées)', () => {
    const result = LlmExtractionResultSchema.parse({ proposals: [], evidence: [] })
    expect(result.proposals).toHaveLength(0)
    expect(result.evidence).toHaveLength(0)
  })

  it('3. rejette une family invalide', () => {
    const raw = {
      proposals: [{ temporaryKey: 'p1', family: 'tache', label: 'Test', evidenceKeys: [] }],
      evidence: [],
    }
    expect(() => LlmExtractionResultSchema.parse(raw)).toThrow()
  })

  it('4. rejette un evidenceType invalide', () => {
    const raw = {
      proposals: [],
      evidence: [{ temporaryKey: 'e1', evidenceType: 'video', sourcePage: 1 }],
    }
    expect(() => LlmExtractionResultSchema.parse(raw)).toThrow()
  })

  it('5. rejette une proposition sans temporaryKey', () => {
    const raw = {
      proposals: [{ family: 'action', label: 'Reprendre le joint', evidenceKeys: [] }],
      evidence: [],
    }
    expect(() => LlmExtractionResultSchema.parse(raw)).toThrow()
  })
})

// ─── Section 2 : Parsing de sortie LLM (simulation sans appel réseau) ─────────

describe('LlmProposalSchema — cas métier', () => {
  it('6. parse une réservation avec sourcePayload complet', () => {
    const raw = {
      temporaryKey: 'res-fissure-p3',
      family: 'reservation',
      label: 'Fissure en façade est — réserve ouverte',
      sourcePage: 3,
      sourceExcerpt: 'fissure verticale de 3 mm',
      sourcePayload: {
        statusAtDocumentDate: 'ouvert',
        dueDate: '2024-05-15',
        responsibleParty: 'Maçonnerie Dupont',
      },
      evidenceKeys: ['ev-text-p3', 'ev-snap-p3'],
    }
    const result = LlmProposalSchema.parse(raw)
    expect(result.family).toBe('reservation')
    expect(result.sourcePayload?.dueDate).toBe('2024-05-15')
    expect(result.evidenceKeys).toHaveLength(2)
  })

  it('7. parse une action avec responsable dans sourcePayload', () => {
    const raw = {
      temporaryKey: 'act-joint-p8',
      family: 'action',
      label: 'Reprise du joint de dilatation',
      sourcePage: 8,
      sourcePayload: { responsibleParty: 'Étanchéité Pro', dueDate: '30/04/2024' },
      evidenceKeys: ['ev-text-p8'],
    }
    const result = LlmProposalSchema.parse(raw)
    expect(result.family).toBe('action')
    expect(result.sourcePayload?.responsibleParty).toBe('Étanchéité Pro')
  })

  it('8. parse une preuve text_excerpt avec texte cité', () => {
    const raw = {
      temporaryKey: 'ev-text-p7-1',
      evidenceType: 'text_excerpt',
      sourcePage: 7,
      text: 'traces d\'humidité visibles sur une longueur de 2 ml',
      caption: null,
    }
    const result = LlmEvidenceSchema.parse(raw)
    expect(result.evidenceType).toBe('text_excerpt')
    expect(result.text).toContain('humidité')
  })

  it('9. tolère une preuve orpheline (aucune proposition ne la référence)', () => {
    // Une preuve peut exister sans être référencée par une proposition
    // (doctrine §9 : photo sans texte adjacent = evidence uniquement)
    const raw = {
      proposals: [],
      evidence: [{
        temporaryKey: 'ev-snap-p12',
        evidenceType: 'page_snapshot',
        sourcePage: 12,
        caption: 'Photo de la fissure en façade nord',
      }],
    }
    const result = LlmExtractionResultSchema.parse(raw)
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0].temporaryKey).toBe('ev-snap-p12')
  })
})

// ─── Section 3 : Orchestrateur extractHistoricalPv ───────────────────────────

const { extractHistoricalPv, shouldAutoLinkEvidence } = await import('../../lib/documents/extract-historical-pv')

// ─── GO point 1 : rattachement preuve ↔ proposition dépend du TYPE de preuve ─

describe('shouldAutoLinkEvidence — GO point 1 (evidence formelle pour toutes les familles)', () => {
  it('text_excerpt est toujours rattachable, quelle que soit la famille (decision/deadline/knowledge_fact inclus)', () => {
    expect(shouldAutoLinkEvidence('decision', 'text_excerpt')).toBe(true)
    expect(shouldAutoLinkEvidence('deadline', 'text_excerpt')).toBe(true)
    expect(shouldAutoLinkEvidence('knowledge_fact', 'text_excerpt')).toBe(true)
    expect(shouldAutoLinkEvidence('person', 'text_excerpt')).toBe(true)
    expect(shouldAutoLinkEvidence('company', 'text_excerpt')).toBe(true)
    expect(shouldAutoLinkEvidence('action', 'text_excerpt')).toBe(true)
    expect(shouldAutoLinkEvidence('observation', 'text_excerpt')).toBe(true)
    expect(shouldAutoLinkEvidence('reservation', 'text_excerpt')).toBe(true)
  })

  it('page_snapshot reste restreint aux familles visuellement observables', () => {
    expect(shouldAutoLinkEvidence('reservation', 'page_snapshot')).toBe(true)
    expect(shouldAutoLinkEvidence('observation', 'page_snapshot')).toBe(true)
    expect(shouldAutoLinkEvidence('action', 'page_snapshot')).toBe(true)
    expect(shouldAutoLinkEvidence('decision', 'page_snapshot')).toBe(false)
    expect(shouldAutoLinkEvidence('deadline', 'page_snapshot')).toBe(false)
    expect(shouldAutoLinkEvidence('knowledge_fact', 'page_snapshot')).toBe(false)
    expect(shouldAutoLinkEvidence('person', 'page_snapshot')).toBe(false)
    expect(shouldAutoLinkEvidence('company', 'page_snapshot')).toBe(false)
  })

  it('un evidenceType indéfini est traité comme rattachable par défaut (ne bloque pas silencieusement)', () => {
    expect(shouldAutoLinkEvidence('decision', undefined)).toBe(true)
  })
})

const FAKE_DOC_ID = 'doc-uuid-1234'
const FAKE_ORG_ID = 'org-uuid-5678'
const FAKE_RUN_ID = 'run-uuid-abcd'

const FAKE_PDF_BUFFER = Buffer.from('fake pdf content')
const FAKE_BLOB = new Blob([FAKE_PDF_BUFFER])

const FIL_ROUGE_TEXT = `[[page 7]]
Réserve n°3 — Infiltration en pied de façade nord : des traces d'humidité sont visibles sur une longueur de 2 ml. Statut : ouverte.

[[page 8]]
Action : M. Dupont (Étanchéité Pro) doit reprendre le joint de dilatation avant le 30/04/2024.

[[page 12]]
[Photo de la fissure en façade nord, pied de mur]`

const FIL_ROUGE_LLM_RESULT = {
  proposals: [
    {
      temporaryKey: 'res-infiltration-p7',
      family: 'reservation' as const,
      label: 'Infiltration en pied de façade nord',
      description: 'Traces d\'humidité sur 2 ml, statut ouvert',
      sourcePage: 7,
      sourceExcerpt: 'traces d\'humidité sont visibles sur une longueur de 2 ml',
      sourcePayload: { statusAtDocumentDate: 'ouvert', dueDate: null, responsibleParty: null },
      evidenceKeys: ['ev-text-p7'],
    },
    {
      temporaryKey: 'act-joint-p8',
      family: 'action' as const,
      label: 'Reprise du joint de dilatation',
      sourcePage: 8,
      sourcePayload: { responsibleParty: 'Étanchéité Pro', dueDate: '30/04/2024' },
      evidenceKeys: ['ev-text-p8'],
    },
  ],
  evidence: [
    {
      temporaryKey: 'ev-text-p7',
      evidenceType: 'text_excerpt' as const,
      sourcePage: 7,
      text: 'traces d\'humidité sont visibles sur une longueur de 2 ml',
    },
    {
      temporaryKey: 'ev-text-p8',
      evidenceType: 'text_excerpt' as const,
      sourcePage: 8,
      text: 'M. Dupont (Étanchéité Pro) doit reprendre le joint de dilatation avant le 30/04/2024',
    },
    {
      temporaryKey: 'ev-snap-p12',
      evidenceType: 'page_snapshot' as const,
      sourcePage: 12,
      caption: 'Photo de la fissure en façade nord',
    },
  ],
}

function setupDefaultMocks() {
  mocks.maybySingle.mockResolvedValue({
    data: { id: FAKE_DOC_ID, storage_path: 'orgs/abc/doc.pdf', organization_id: FAKE_ORG_ID, document_type: 'historical_visit_report' },
    error: null,
  })
  mocks.storageDownload.mockResolvedValue({ data: FAKE_BLOB, error: null })
  mocks.storageUpload.mockResolvedValue({ data: {}, error: null })
  mocks.extractPdfText.mockResolvedValue({ text: FIL_ROUGE_TEXT, pageCount: 12, charCount: 350, isLikelyScanned: false })
  mocks.renderPdfPage.mockResolvedValue(null)
  mocks.extractHistoricalPvProposals.mockResolvedValue(FIL_ROUGE_LLM_RESULT)
  mocks.createExtractionRun.mockResolvedValue(FAKE_RUN_ID)
  mocks.updateExtractionRunStatus.mockResolvedValue(undefined)
  mocks.insertExtractionEvidence.mockResolvedValue([
    { id: 'ev-id-1', storage_path: null },
    { id: 'ev-id-2', storage_path: null },
    { id: 'ev-id-3', storage_path: null },
  ])
  mocks.insertExtractionProposals.mockResolvedValue(['prop-id-1', 'prop-id-2'])
  mocks.linkProposalEvidence.mockResolvedValue(undefined)
}

describe('extractHistoricalPv — orchestrateur', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('10. happy path → run pending→processing→ready_for_review, proposals et evidence persistées', async () => {
    await extractHistoricalPv(FAKE_DOC_ID, 'user-123')

    expect(mocks.createExtractionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: FAKE_DOC_ID,
        organization_id: FAKE_ORG_ID,
        extractor_key: 'historical_visit_report_v1',
        created_by: 'user-123',
      }),
    )
    expect(mocks.updateExtractionRunStatus).toHaveBeenCalledWith(FAKE_RUN_ID, 'processing', expect.objectContaining({ started_at: expect.any(String) }))
    expect(mocks.insertExtractionEvidence).toHaveBeenCalledWith(FAKE_RUN_ID, expect.any(Array))
    expect(mocks.insertExtractionProposals).toHaveBeenCalledWith(FAKE_RUN_ID, expect.any(Array))
    expect(mocks.updateExtractionRunStatus).toHaveBeenCalledWith(FAKE_RUN_ID, 'ready_for_review', expect.objectContaining({ completed_at: expect.any(String) }))
  })

  it('11. type de document incorrect → return sans créer de run', async () => {
    mocks.maybySingle.mockResolvedValue({
      data: { id: FAKE_DOC_ID, storage_path: 'x.pdf', organization_id: FAKE_ORG_ID, document_type: 'contrat' },
      error: null,
    })

    await extractHistoricalPv(FAKE_DOC_ID)

    expect(mocks.createExtractionRun).not.toHaveBeenCalled()
  })

  it('12. document introuvable → return sans créer de run', async () => {
    mocks.maybySingle.mockResolvedValue({ data: null, error: null })

    await extractHistoricalPv(FAKE_DOC_ID)

    expect(mocks.createExtractionRun).not.toHaveBeenCalled()
  })

  it('13. PDF scanné → utilise OCR, extraction LLM appelée avec le texte OCR', async () => {
    const ocrText = '[[page 1]]\nTexte OCR extrait du PDF scanné. '.repeat(20)
    mocks.extractPdfText.mockResolvedValue({ text: '', pageCount: 3, charCount: 50, isLikelyScanned: true })
    mocks.extractWithGeminiOCR.mockResolvedValue(ocrText)
    mocks.extractHistoricalPvProposals.mockResolvedValue({ proposals: [], evidence: [] })
    mocks.insertExtractionEvidence.mockResolvedValue([])
    mocks.insertExtractionProposals.mockResolvedValue([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).process = { ...process, env: { ...process.env, GOOGLE_GENAI_API_KEY: 'test-key' } }

    await extractHistoricalPv(FAKE_DOC_ID)

    expect(mocks.extractWithGeminiOCR).toHaveBeenCalled()
    expect(mocks.extractHistoricalPvProposals).toHaveBeenCalledWith(
      expect.stringContaining('Texte OCR'),
      3,
    )
  })

  it('14. mupdf disponible → snapshot uploadé, storage_path renseigné pour page_snapshot', async () => {
    const fakeRendered = { buffer: Buffer.from('fake-png'), width: 595, height: 842 }
    mocks.renderPdfPage.mockResolvedValue(fakeRendered)
    mocks.extractHistoricalPvProposals.mockResolvedValue({
      proposals: [],
      evidence: [{
        temporaryKey: 'ev-snap-p12',
        evidenceType: 'page_snapshot',
        sourcePage: 12,
        caption: 'Photo fissure',
      }],
    })
    mocks.insertExtractionEvidence.mockResolvedValue([{ id: 'ev-id-1', storage_path: null }])
    mocks.insertExtractionProposals.mockResolvedValue([])

    await extractHistoricalPv(FAKE_DOC_ID)

    expect(mocks.storageUpload).toHaveBeenCalledWith(
      expect.stringContaining(`snapshots/${FAKE_DOC_ID}/page-`),
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'image/png' }),
    )
    const evidenceCall = mocks.insertExtractionEvidence.mock.calls[0][1]
    const snap = evidenceCall.find((e: { evidence_type: string }) => e.evidence_type === 'page_snapshot')
    expect(snap.storage_path).toMatch(new RegExp(`snapshots/${FAKE_DOC_ID}/page-12`))
  })

  it('15. mupdf échoue (renderPdfPage=null) → evidence page_snapshot avec storage_path=null', async () => {
    mocks.renderPdfPage.mockResolvedValue(null)
    mocks.extractHistoricalPvProposals.mockResolvedValue({
      proposals: [],
      evidence: [{
        temporaryKey: 'ev-snap-p5',
        evidenceType: 'page_snapshot',
        sourcePage: 5,
        caption: 'Croquis de chantier',
      }],
    })
    mocks.insertExtractionEvidence.mockResolvedValue([{ id: 'ev-id-1', storage_path: null }])
    mocks.insertExtractionProposals.mockResolvedValue([])

    await extractHistoricalPv(FAKE_DOC_ID)

    const evidenceCall = mocks.insertExtractionEvidence.mock.calls[0][1]
    const snap = evidenceCall.find((e: { evidence_type: string }) => e.evidence_type === 'page_snapshot')
    expect(snap.storage_path).toBeNull()
    expect(snap.source_page).toBe(5)
  })

  it('16. extraction LLM échoue → run status=failed, error_message renseigné', async () => {
    mocks.extractHistoricalPvProposals.mockRejectedValue(new Error('Gemini API timeout'))

    await extractHistoricalPv(FAKE_DOC_ID)

    expect(mocks.updateExtractionRunStatus).toHaveBeenCalledWith(
      FAKE_RUN_ID,
      'failed',
      expect.objectContaining({ error_message: 'Gemini API timeout' }),
    )
    expect(mocks.insertExtractionProposals).not.toHaveBeenCalled()
  })

  it('17. [fil rouge] page 7 → réservation infiltration persistée avec label correct', async () => {
    await extractHistoricalPv(FAKE_DOC_ID)

    const proposalCall = mocks.insertExtractionProposals.mock.calls[0][1]
    const reservation = proposalCall.find(
      (p: { proposal_family: string }) => p.proposal_family === 'reservation',
    )
    expect(reservation).toBeDefined()
    expect(reservation.label).toBe('Infiltration en pied de façade nord')
    expect(reservation.source_page).toBe(7)
    expect(reservation.stable_key).toBe('res-infiltration-p7')
  })

  it('18. [fil rouge] preuve ev-text-p7 correctement liée à la proposition res-infiltration-p7', async () => {
    await extractHistoricalPv(FAKE_DOC_ID)

    // insertExtractionEvidence retourne ['ev-id-1', 'ev-id-2', 'ev-id-3']
    // insertExtractionProposals retourne ['prop-id-1', 'prop-id-2']
    // res-infiltration-p7 → prop-id-1 (index 0)
    // ev-text-p7 → ev-id-1 (index 0 dans evidence)
    expect(mocks.linkProposalEvidence).toHaveBeenCalledWith(
      'prop-id-1',
      'ev-id-1',
      'supports',
    )
  })

  it('19. [GO point 1] decision/deadline/knowledge_fact avec preuve texte → evidence réellement liée (régression corrigée)', async () => {
    mocks.extractHistoricalPvProposals.mockResolvedValue({
      proposals: [
        {
          temporaryKey: 'dec-1',
          family: 'decision',
          label: 'Décision de reprise des travaux',
          sourcePage: 2,
          sourceExcerpt: 'le maître d\'ouvrage décide la reprise des travaux le 15/05',
          evidenceKeys: ['ev-text-1'],
        },
        {
          temporaryKey: 'dl-1',
          family: 'deadline',
          label: 'Échéance de livraison des plans',
          sourcePage: 3,
          sourceExcerpt: 'les plans corrigés sont attendus avant le 30/06',
          evidenceKeys: ['ev-text-2'],
        },
        {
          temporaryKey: 'kf-1',
          family: 'knowledge_fact',
          label: 'Norme applicable au désenfumage',
          sourcePage: 4,
          sourceExcerpt: 'la norme impose un désenfumage naturel en cage d\'escalier',
          evidenceKeys: ['ev-text-3', 'ev-snap-1'],
        },
      ],
      evidence: [
        { temporaryKey: 'ev-text-1', evidenceType: 'text_excerpt', sourcePage: 2, text: 'le maître d\'ouvrage décide la reprise des travaux le 15/05' },
        { temporaryKey: 'ev-text-2', evidenceType: 'text_excerpt', sourcePage: 3, text: 'les plans corrigés sont attendus avant le 30/06' },
        { temporaryKey: 'ev-text-3', evidenceType: 'text_excerpt', sourcePage: 4, text: 'la norme impose un désenfumage naturel en cage d\'escalier' },
        { temporaryKey: 'ev-snap-1', evidenceType: 'page_snapshot', sourcePage: 4, caption: 'Photo de la cage d\'escalier' },
      ],
    })
    mocks.insertExtractionProposals.mockResolvedValue(['prop-dec-1', 'prop-dl-1', 'prop-kf-1'])
    mocks.insertExtractionEvidence.mockResolvedValue([
      { id: 'ev-id-dec', storage_path: null },
      { id: 'ev-id-dl', storage_path: null },
      { id: 'ev-id-kf', storage_path: null },
      { id: 'ev-id-snap', storage_path: null },
    ])

    await extractHistoricalPv(FAKE_DOC_ID)

    expect(mocks.linkProposalEvidence).toHaveBeenCalledWith('prop-dec-1', 'ev-id-dec', 'supports')
    expect(mocks.linkProposalEvidence).toHaveBeenCalledWith('prop-dl-1', 'ev-id-dl', 'supports')
    expect(mocks.linkProposalEvidence).toHaveBeenCalledWith('prop-kf-1', 'ev-id-kf', 'supports')
  })

  it('20. [GO point 1] page_snapshot reste exclu pour knowledge_fact — aucune duplication artificielle d\'evidence', async () => {
    mocks.extractHistoricalPvProposals.mockResolvedValue({
      proposals: [{
        temporaryKey: 'kf-1',
        family: 'knowledge_fact',
        label: 'Norme applicable au désenfumage',
        sourcePage: 4,
        sourceExcerpt: 'la norme impose un désenfumage naturel en cage d\'escalier',
        evidenceKeys: ['ev-text-3', 'ev-snap-1'],
      }],
      evidence: [
        { temporaryKey: 'ev-text-3', evidenceType: 'text_excerpt', sourcePage: 4, text: 'la norme impose un désenfumage naturel en cage d\'escalier' },
        { temporaryKey: 'ev-snap-1', evidenceType: 'page_snapshot', sourcePage: 4, caption: 'Photo de la cage d\'escalier' },
      ],
    })
    mocks.insertExtractionProposals.mockResolvedValue(['prop-kf-1'])
    mocks.insertExtractionEvidence.mockResolvedValue([
      { id: 'ev-id-kf', storage_path: null },
      { id: 'ev-id-snap', storage_path: null },
    ])

    await extractHistoricalPv(FAKE_DOC_ID)

    expect(mocks.linkProposalEvidence).toHaveBeenCalledTimes(1)
    expect(mocks.linkProposalEvidence).toHaveBeenCalledWith('prop-kf-1', 'ev-id-kf', 'supports')
    expect(mocks.linkProposalEvidence).not.toHaveBeenCalledWith('prop-kf-1', 'ev-id-snap', expect.anything())
  })
})
