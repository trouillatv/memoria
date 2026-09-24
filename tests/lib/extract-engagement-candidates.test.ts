import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// P0-2B — orchestrateur d'extraction prescriptive de candidats Engagements
// (lib/documents/extract-engagement-candidates.ts). Couvre : éligibilité de
// type, garde d'organisation stricte (cross-org), rattachement chantier,
// idempotence de run, grounding obligatoire (extrait verbatim + page dérivée
// mécaniquement via locateQuote — jamais devinée par le LLM), preuve
// obligatoire (evidence liée), et classification des échecs techniques.
//
// locateQuote (services/ai/source-validation.ts) N'EST PAS mocké : c'est une
// fonction pure, et sa correction d'intégration avec l'orchestrateur (dérivation
// réelle de la page depuis les marqueurs [[page N]]) fait partie de ce qui doit
// être prouvé, pas supposé.

const DOC_ORG = 'org-agp'
const OTHER_ORG = 'org-capse'
const DOC_ID = 'doc-1'
const SITE_ID = 'site-1'
const OTHER_ORG_SITE_ID = 'site-other-org'

let documents: Record<string, { id: string; storage_path: string; organization_id: string; document_type: string } | null> = {}
let documentLinks: Record<string, { target_id: string } | null> = {}
let sites: Record<string, { id: string; organization_id: string } | null> = {}
let downloadResult: { data: Blob | null; error: { message: string } | null } = {
  data: new Blob(['%PDF-fake%']),
  error: null,
}

let membershipOk = true

let existingRun: { id: string; status: string } | null = null
const createExtractionRun = vi.fn(async (..._args: unknown[]) => 'run-new')
const updateExtractionRunStatus = vi.fn(async (..._args: unknown[]) => {})
const updateExtractionStage = vi.fn(async (..._args: unknown[]) => {})
const insertExtractionProposals = vi.fn(async (_runId: string, proposals: unknown[]) =>
  proposals.map((_p, i) => `prop-${i + 1}`),
)
const insertExtractionEvidence = vi.fn(async (_runId: string, items: unknown[]) =>
  items.map((_e, i) => ({ id: `ev-${i + 1}`, storage_path: null })),
)
const linkProposalEvidence = vi.fn(async (..._args: unknown[]) => {})
const getLatestExtractionRunForDocument = vi.fn(async (..._args: unknown[]) => existingRun)

let extractPdfTextResult = { text: '', pageCount: 1, charCount: 0, isLikelyScanned: false }
const extractPdfText = vi.fn(async () => extractPdfTextResult)
let ocrText: string | null = null
const extractWithGeminiOCR = vi.fn(async () => ocrText)

let agentResult: { candidates: unknown[]; metadata: Record<string, unknown> } = { candidates: [], metadata: {} }
const runEngagementCandidateExtractionAgent = vi.fn(async () => agentResult)

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const eqs: Record<string, unknown> = {}
      const api = {
        select: () => api,
        eq: (col: string, val: unknown) => { eqs[col] = val; return api },
        is: (_col: string, val: unknown) => { eqs[_col] = val; return api },
        maybeSingle: async () => {
          if (table === 'documents') return { data: documents[eqs.id as string] ?? null, error: null }
          if (table === 'document_links') return { data: documentLinks[eqs.document_id as string] ?? null, error: null }
          if (table === 'sites') return { data: sites[eqs.id as string] ?? null, error: null }
          return { data: null, error: null }
        },
      }
      return api
    },
    storage: { from: () => ({ download: async () => downloadResult }) },
  }),
}))

vi.mock('@/lib/auth/memberships', () => ({
  requireOrganizationMembership: async (organizationId: string) =>
    membershipOk
      ? { ok: true, context: { userId: 'user-1', organizationId, role: 'manager' } }
      : { ok: false, error: 'Accès refusé' },
}))

vi.mock('@/lib/db/document-extractions', () => ({
  createExtractionRun,
  updateExtractionRunStatus,
  updateExtractionStage,
  insertExtractionProposals,
  insertExtractionEvidence,
  linkProposalEvidence,
  getLatestExtractionRunForDocument,
  READY_STATUSES: new Set(['ready_for_review', 'partially_materialized', 'materialized']),
}))

vi.mock('@/services/pdf/extract', () => ({
  extractPdfText,
  extractWithGeminiOCR,
}))

vi.mock('@/services/ai/engagement-prescriptif-extraction', () => ({
  runEngagementCandidateExtractionAgent,
}))

const { extractEngagementCandidates } = await import('@/lib/documents/extract-engagement-candidates')

function candidate(overrides: Partial<{
  label: string; description: string | null; sourceExcerpt: string
  categorySuggestion: string; kind: string; measurable: boolean
  frequencyRaw: string | null; aiConfidence: number
}> = {}) {
  return {
    label: 'Nettoyage quotidien des sanitaires',
    description: null,
    sourceExcerpt: 'Le prestataire assure un nettoyage quotidien des sanitaires du site.',
    categorySuggestion: 'frequency',
    kind: 'obligation',
    measurable: true,
    frequencyRaw: 'quotidien',
    aiConfidence: 0.9,
    ...overrides,
  }
}

const SOURCE_TEXT = [
  '[[page 1]]',
  'Préambule du marché. Objet et généralités du présent CCTP.',
  '[[page 2]]',
  'Le prestataire assure un nettoyage quotidien des sanitaires du site.',
  '[[page 3]]',
  'Un rapport d\'intervention est remis au client à chaque visite du technicien.',
].join('\n')

beforeEach(() => {
  vi.clearAllMocks()
  documents = {
    [DOC_ID]: { id: DOC_ID, storage_path: `contracts/${DOC_ID}.pdf`, organization_id: DOC_ORG, document_type: 'cctp' },
  }
  documentLinks = { [DOC_ID]: { target_id: SITE_ID } }
  sites = {
    [SITE_ID]: { id: SITE_ID, organization_id: DOC_ORG },
    [OTHER_ORG_SITE_ID]: { id: OTHER_ORG_SITE_ID, organization_id: OTHER_ORG },
  }
  downloadResult = { data: new Blob(['%PDF-fake%']), error: null }
  membershipOk = true
  existingRun = null
  extractPdfTextResult = { text: SOURCE_TEXT, pageCount: 3, charCount: SOURCE_TEXT.length, isLikelyScanned: false }
  ocrText = null
  agentResult = { candidates: [candidate()], metadata: { provider: 'mock' } }
  createExtractionRun.mockResolvedValue('run-new')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('éligibilité du type de document', () => {
  it('type éligible (cctp) → traite le document', async () => {
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
  })

  it('type inéligible (facture) → refus avant tout traitement', async () => {
    documents[DOC_ID]!.document_type = 'facture'
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/non éligible/i)
    expect(createExtractionRun).not.toHaveBeenCalled()
  })
})

describe('document introuvable', () => {
  it('document absent (soft-deleted ou inexistant) → refus', async () => {
    documents = {}
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Document introuvable')
  })
})

describe('garde d\'organisation stricte (cross-org)', () => {
  it('utilisateur non membre de l\'organisation du document → refus, aucun run créé', async () => {
    membershipOk = false
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Accès refusé')
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('chantier rattaché appartient à une autre organisation que le document → refus', async () => {
    documentLinks[DOC_ID] = { target_id: OTHER_ORG_SITE_ID }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/hors organisation/i)
    expect(createExtractionRun).not.toHaveBeenCalled()
  })
})

describe('rattachement chantier obligatoire', () => {
  it('document non rattaché à un chantier → refus, aucun run créé', async () => {
    documentLinks = {}
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/rattaché/i)
    expect(createExtractionRun).not.toHaveBeenCalled()
  })
})

describe('idempotence', () => {
  it('run déjà en cours (processing) → refus explicite, aucun nouveau run', async () => {
    existingRun = { id: 'run-in-flight', status: 'processing' }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/déjà en cours/i)
      expect(r.runId).toBe('run-in-flight')
    }
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('run déjà exploitable (ready_for_review) sans force → réutilisé, pas de ré-extraction', async () => {
    existingRun = { id: 'run-ready', status: 'ready_for_review' }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reused).toBe(true)
      expect(r.runId).toBe('run-ready')
    }
    expect(createExtractionRun).not.toHaveBeenCalled()
    expect(runEngagementCandidateExtractionAgent).not.toHaveBeenCalled()
  })

  it('run déjà exploitable mais force=true → relance complète', async () => {
    existingRun = { id: 'run-ready', status: 'ready_for_review' }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1', { force: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.reused).toBe(false)
    expect(createExtractionRun).toHaveBeenCalledTimes(1)
    expect(runEngagementCandidateExtractionAgent).toHaveBeenCalledTimes(1)
  })
})

describe('grounding obligatoire — page dérivée mécaniquement, jamais devinée', () => {
  it('extrait localisable verbatim → proposal créée avec la page dérivée du marqueur [[page N]]', async () => {
    agentResult = { candidates: [candidate({ sourceExcerpt: 'Le prestataire assure un nettoyage quotidien des sanitaires du site.' })], metadata: {} }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(1)
    expect(insertExtractionProposals).toHaveBeenCalledTimes(1)
    const [, proposals] = insertExtractionProposals.mock.calls[0]!
    expect((proposals as Array<{ source_page: number | null }>)[0]!.source_page).toBe(2)
  })

  it('extrait introuvable verbatim (paraphrase/hallucination) → candidat écarté, aucune proposal pour lui', async () => {
    agentResult = {
      candidates: [candidate({ label: 'Clause inventée', sourceExcerpt: 'Ceci ne figure nulle part dans le texte source.' })],
      metadata: {},
    }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(0)
    expect(insertExtractionProposals).not.toHaveBeenCalled()
  })

  it('mix valide/invalide → seul le candidat vérifiable produit une proposal', async () => {
    agentResult = {
      candidates: [
        candidate({ label: 'Valide', sourceExcerpt: 'Un rapport d\'intervention est remis au client à chaque visite du technicien.' }),
        candidate({ label: 'Invalide', sourceExcerpt: 'Texte totalement absent du document.' }),
      ],
      metadata: {},
    }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(1)
    const [, proposals] = insertExtractionProposals.mock.calls[0]!
    expect((proposals as Array<{ label: string }>)).toHaveLength(1)
    expect((proposals as Array<{ label: string }>)[0]!.label).toBe('Valide')
  })
})

describe('aucun candidat retenu', () => {
  it('agent ne retourne aucun candidat → run ready_for_review avec empty_reason, aucune insertion', async () => {
    agentResult = { candidates: [], metadata: {} }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(0)
    expect(insertExtractionProposals).not.toHaveBeenCalled()
    const statusCall = updateExtractionRunStatus.mock.calls.find((c) => c[1] === 'ready_for_review')
    expect(statusCall?.[2]).toMatchObject({ empty_reason: 'NO_BUSINESS_ELEMENT_DETECTED' })
  })
})

describe('preuve obligatoire (evidence liée à chaque proposal)', () => {
  it('chaque proposal reçoit une evidence text_excerpt liée en relation supports', async () => {
    await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(insertExtractionEvidence).toHaveBeenCalledTimes(1)
    const [, items] = insertExtractionEvidence.mock.calls[0]!
    expect((items as Array<{ evidence_type: string; nearby_text: string | null }>)[0]).toMatchObject({
      evidence_type: 'text_excerpt',
    })
    expect(linkProposalEvidence).toHaveBeenCalledWith('prop-1', 'ev-1', 'supports')
  })
})

describe('échecs techniques', () => {
  it('téléchargement du fichier échoue → run marqué failed, résultat en échec', async () => {
    downloadResult = { data: null, error: { message: 'not_found' } }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    const failCall = updateExtractionRunStatus.mock.calls.find((c) => c[1] === 'failed')
    expect(failCall).toBeTruthy()
  })

  it('aucun texte extractible (natif insuffisant, pas d\'OCR disponible) → OCR_FAILURE', async () => {
    extractPdfTextResult = { text: '', pageCount: 0, charCount: 0, isLikelyScanned: true }
    ocrText = null
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    const failCall = updateExtractionRunStatus.mock.calls.find((c) => c[1] === 'failed')
    expect(failCall?.[2]).toMatchObject({ empty_reason: 'OCR_FAILURE' })
  })

  it('bascule sur l\'OCR si le texte natif est insuffisant et qu\'une clé Gemini est configurée', async () => {
    vi.stubEnv('GOOGLE_GENAI_API_KEY', 'test-key')
    extractPdfTextResult = { text: '', pageCount: 1, charCount: 0, isLikelyScanned: true }
    ocrText = SOURCE_TEXT
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    expect(extractWithGeminiOCR).toHaveBeenCalledTimes(1)
  })

  it('erreur inattendue de l\'agent d\'extraction → run marqué failed avec TECHNICAL_FAILURE', async () => {
    runEngagementCandidateExtractionAgent.mockRejectedValueOnce(new Error('provider_timeout'))
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('provider_timeout')
    const failCall = updateExtractionRunStatus.mock.calls.find((c) => c[1] === 'failed')
    expect(failCall?.[2]).toMatchObject({ empty_reason: 'TECHNICAL_FAILURE' })
  })
})
