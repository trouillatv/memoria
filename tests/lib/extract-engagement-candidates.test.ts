import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1 } from '@/services/ai/prompts/engagement-extractor-prescriptif.v1'

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
let membershipRole: string = 'manager'

// existingRun n'est "visible" que si on l'interroge avec le MÊME extractor_key
// que celui qui l'a produit — reproduit fidèlement le filtre .eq('extractor_key', …)
// de la vraie requête (lib/db/document-extractions.ts), sans quoi le test ne
// prouverait rien sur le scoping (P0-2B FIX_REQUIRED point 2).
let existingRun: { id: string; status: string; extractor_version?: string } | null = null
let existingRunExtractorKey = 'engagement_prescriptif_v1'
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
const getLatestExtractionRunForDocumentAndExtractor = vi.fn(
  async (_documentId: string, extractorKey: string) =>
    extractorKey === existingRunExtractorKey ? existingRun : null,
)

let extractPdfTextResult = { text: '', pageCount: 1, charCount: 0, isLikelyScanned: false }
const extractPdfText = vi.fn(async () => extractPdfTextResult)
let ocrText: string | null = null
const extractWithGeminiOCR = vi.fn(async () => ocrText)

let agentResult: { candidates: unknown[]; metadata: Record<string, unknown> } = { candidates: [], metadata: {} }
const runEngagementCandidateExtractionAgent = vi.fn(async () => agentResult)

// null par défaut → délègue au VRAI buildPageWindows (module pur, non mocké
// pour son comportement de base) ; les tests de découpage/déduplication
// (P0-2B FIX_REQUIRED points 1 et 3) le surchargent pour contrôler exactement
// les fenêtres soumises à l'agent sans avoir à construire un texte géant.
let pageWindowsOverride: Array<{ index: number; pages: number[]; text: string }> | null = null

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
  requireOrganizationRole: async (organizationId: string, allowedRoles: string[]) => {
    if (!membershipOk) return { ok: false, error: 'Accès refusé' }
    if (!allowedRoles.includes(membershipRole)) return { ok: false, error: 'Accès refusé' }
    return { ok: true, context: { userId: 'user-1', organizationId, role: membershipRole } }
  },
}))

vi.mock('@/lib/db/document-extractions', () => ({
  createExtractionRun,
  updateExtractionRunStatus,
  updateExtractionStage,
  insertExtractionProposals,
  insertExtractionEvidence,
  linkProposalEvidence,
  getLatestExtractionRunForDocumentAndExtractor,
  READY_STATUSES: new Set(['ready_for_review', 'partially_materialized', 'materialized']),
}))

vi.mock('@/services/pdf/extract', () => ({
  extractPdfText,
  extractWithGeminiOCR,
}))

vi.mock('@/services/ai/engagement-prescriptif-extraction', () => ({
  runEngagementCandidateExtractionAgent,
}))

vi.mock('@/lib/documents/page-windows', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documents/page-windows')>(
    '@/lib/documents/page-windows',
  )
  return {
    ...actual,
    buildPageWindows: (text: string) => pageWindowsOverride ?? actual.buildPageWindows(text),
  }
})

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
  membershipRole = 'manager'
  existingRun = null
  existingRunExtractorKey = 'engagement_prescriptif_v1'
  extractPdfTextResult = { text: SOURCE_TEXT, pageCount: 3, charCount: SOURCE_TEXT.length, isLikelyScanned: false }
  ocrText = null
  agentResult = { candidates: [candidate()], metadata: { provider: 'mock' } }
  pageWindowsOverride = null
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

  // P0-2D FIX_REQUIRED (revue Vincent 2026-09-25) — rôle plateforme ≠ pouvoir
  // métier : la route API n'autorise plus rien elle-même, seul le rôle DANS
  // l'organisation du document fait foi ici. Ces 4 cas prouvent que ni un rôle
  // global, ni une appartenance sans le bon rôle, ni une appartenance à une
  // AUTRE organisation ne peuvent se substituer à ce garde-fou canonique.

  it('aucune appartenance à l\'organisation du document (même avec un rôle plateforme admin) → refus', async () => {
    membershipOk = false
    membershipRole = 'admin'
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Accès refusé')
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('membre actif de l\'organisation du document mais sans rôle manager/admin (ex. technicien) → refus', async () => {
    membershipRole = 'technicien'
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Accès refusé')
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('membre actif avec rôle manager dans l\'organisation du document → autorisé, quel que soit le rôle plateforme', async () => {
    membershipRole = 'manager'
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    expect(createExtractionRun).toHaveBeenCalledTimes(1)
  })

  it('rôle manager détenu dans une AUTRE organisation ne donne aucun droit ici (le mock ne connaît que la garde de l\'organisation du document)', async () => {
    // Le membership est résolu STRICTEMENT pour d.organization_id (jamais un
    // rôle porté ailleurs) : le rejeter revient à ne pas être membre ICI.
    membershipOk = false
    membershipRole = 'manager'
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

  it('run déjà en cours (processing) bloque MÊME si sa version diffère de la version courante — le refus concurrent ignore la version', async () => {
    existingRun = { id: 'run-in-flight', status: 'processing', extractor_version: '0.9.0' }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/déjà en cours/i)
      expect(r.runId).toBe('run-in-flight')
    }
    expect(createExtractionRun).not.toHaveBeenCalled()
  })

  it('run déjà exploitable (ready_for_review), MÊME version → réutilisé, pas de ré-extraction', async () => {
    existingRun = { id: 'run-ready', status: 'ready_for_review', extractor_version: '1.0.0' }
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
    existingRun = { id: 'run-ready', status: 'ready_for_review', extractor_version: '1.0.0' }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1', { force: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.reused).toBe(false)
    expect(createExtractionRun).toHaveBeenCalledTimes(1)
    expect(runEngagementCandidateExtractionAgent).toHaveBeenCalledTimes(1)
  })

  it('run READY existant mais d\'un AUTRE extractor_key (ex. historical_pv_v1) → ignoré, profil relancé', async () => {
    existingRun = { id: 'run-other-extractor', status: 'ready_for_review', extractor_version: '1.0.0' }
    existingRunExtractorKey = 'historical_pv_v1'
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.reused).toBe(false)
    expect(createExtractionRun).toHaveBeenCalledTimes(1)
    expect(runEngagementCandidateExtractionAgent).toHaveBeenCalled()
  })

  it('run READY existant mais de version ANTÉRIEURE à EXTRACTOR_VERSION → pas réutilisé, nouvelle extraction propre', async () => {
    existingRun = { id: 'run-old-version', status: 'ready_for_review', extractor_version: '0.9.0' }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reused).toBe(false)
      expect(r.runId).toBe('run-new')
    }
    expect(createExtractionRun).toHaveBeenCalledTimes(1)
    expect(runEngagementCandidateExtractionAgent).toHaveBeenCalled()
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

describe('grounding cross-page — jamais de concaténation à travers [[page N]] (P0-2B FIX_REQUIRED "très léger" point 1)', () => {
  // Clause réelle à cheval sur une frontière de page : le marqueur [[page 3]]
  // reste physiquement présent ENTRE les deux fragments dans le texte source.
  // normalizeForMatch (orchestrateur) ne fait que replier les espaces / mettre
  // en minuscules — il ne retire JAMAIS ce marqueur. Un extrait qui le
  // traverserait ne pourra donc jamais être relocalisé tel quel : c'est
  // pourquoi le prompt (services/ai/prompts/engagement-extractor-prescriptif.v1.ts)
  // impose désormais un extrait mono-page pour ce cas.
  const CROSS_PAGE_TEXT = [
    '[[page 1]]',
    'Préambule du marché. Objet et généralités du présent CCTP, contexte administratif complet.',
    '[[page 2]]',
    'Le prestataire garantit',
    '[[page 3]]',
    'une intervention sous 4 heures ouvrées.',
  ].join('\n')

  it('extrait mono-page (contenu dans la seule page 3) pour une clause à cheval sur deux pages → proposal conservée, page correcte, aucun faux rejet', async () => {
    extractPdfTextResult = { text: CROSS_PAGE_TEXT, pageCount: 3, charCount: CROSS_PAGE_TEXT.length, isLikelyScanned: false }
    agentResult = {
      candidates: [candidate({ label: 'Délai de reprise', sourceExcerpt: 'une intervention sous 4 heures ouvrées.' })],
      metadata: {},
    }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(1)
    expect(insertExtractionProposals).toHaveBeenCalledTimes(1)
    const [, proposals] = insertExtractionProposals.mock.calls[0]!
    expect((proposals as Array<{ source_page: number | null }>)[0]!.source_page).toBe(3)
    expect(insertExtractionEvidence).toHaveBeenCalledTimes(1)
    expect(linkProposalEvidence).toHaveBeenCalledWith('prop-1', 'ev-1', 'supports')
  })

  it('extrait artificiellement concaténé à travers la frontière [[page N]] → rejeté comme invérifiable, aucune proposal (moins de propositions, jamais de fausse preuve)', async () => {
    extractPdfTextResult = { text: CROSS_PAGE_TEXT, pageCount: 3, charCount: CROSS_PAGE_TEXT.length, isLikelyScanned: false }
    agentResult = {
      candidates: [candidate({
        label: 'Délai de reprise (concaténation artificielle)',
        sourceExcerpt: 'Le prestataire garantit une intervention sous 4 heures ouvrées.',
      })],
      metadata: {},
    }
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(0)
    expect(insertExtractionProposals).not.toHaveBeenCalled()
  })
})

describe('version — source unique (P0-2B FIX_REQUIRED "très léger" point 2)', () => {
  it('extractor_version persisté par createExtractionRun est EXACTEMENT ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1.version — aucune constante dupliquée ne peut diverger', async () => {
    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    expect(createExtractionRun).toHaveBeenCalledTimes(1)
    const [arg] = createExtractionRun.mock.calls[0]!
    expect((arg as { extractor_version: string }).extractor_version).toBe(ENGAGEMENT_EXTRACTOR_PRESCRIPTIF_V1.version)
  })
})

describe('découpage en fenêtres de pages et déduplication déterministe (P0-2B FIX_REQUIRED points 1 et 3)', () => {
  const MULTI_WINDOW_TEXT = [
    '[[page 1]]',
    'Clause de la première fenêtre : le prestataire nettoie quotidiennement les locaux techniques.',
    '[[page 5]]',
    'Clause de la dernière fenêtre : un rapport de synthèse est transmis chaque trimestre au client.',
  ].join('\n')

  it('document multi-fenêtres → un appel LLM par fenêtre, candidats de la PREMIÈRE et de la DERNIÈRE fenêtre tous deux retenus', async () => {
    extractPdfTextResult = { text: MULTI_WINDOW_TEXT, pageCount: 2, charCount: MULTI_WINDOW_TEXT.length, isLikelyScanned: false }
    pageWindowsOverride = [
      { index: 0, pages: [1], text: '[[page 1]]Clause de la première fenêtre : le prestataire nettoie quotidiennement les locaux techniques.' },
      { index: 1, pages: [5], text: '[[page 5]]Clause de la dernière fenêtre : un rapport de synthèse est transmis chaque trimestre au client.' },
    ]
    runEngagementCandidateExtractionAgent
      .mockImplementationOnce(async () => ({
        candidates: [candidate({ label: 'Première fenêtre', sourceExcerpt: 'Clause de la première fenêtre : le prestataire nettoie quotidiennement les locaux techniques.' })],
        metadata: {},
      }))
      .mockImplementationOnce(async () => ({
        candidates: [candidate({ label: 'Dernière fenêtre', sourceExcerpt: 'Clause de la dernière fenêtre : un rapport de synthèse est transmis chaque trimestre au client.' })],
        metadata: {},
      }))

    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(2)
    expect(runEngagementCandidateExtractionAgent).toHaveBeenCalledTimes(2)
    const [, proposals] = insertExtractionProposals.mock.calls[0]!
    const labels = (proposals as Array<{ label: string; source_page: number | null }>).map((p) => p.label)
    expect(labels).toEqual(['Première fenêtre', 'Dernière fenêtre'])
    expect((proposals as Array<{ source_page: number | null }>).map((p) => p.source_page)).toEqual([1, 5])
  })

  it('même candidat retourné par deux fenêtres qui se chevauchent → UNE seule proposal (dédup déterministe par page + extrait)', async () => {
    pageWindowsOverride = [
      { index: 0, pages: [1, 2], text: '[[page 1]]...[[page 2]]Le prestataire assure un nettoyage quotidien des sanitaires du site.' },
      { index: 1, pages: [2, 3], text: '[[page 2]]Le prestataire assure un nettoyage quotidien des sanitaires du site.[[page 3]]...' },
    ]
    const overlapCandidate = candidate({ sourceExcerpt: 'Le prestataire assure un nettoyage quotidien des sanitaires du site.' })
    runEngagementCandidateExtractionAgent
      .mockImplementationOnce(async () => ({ candidates: [overlapCandidate], metadata: {} }))
      .mockImplementationOnce(async () => ({ candidates: [overlapCandidate], metadata: {} }))

    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(1)
    expect(runEngagementCandidateExtractionAgent).toHaveBeenCalledTimes(2)
    expect(insertExtractionProposals).toHaveBeenCalledTimes(1)
    const [, proposals] = insertExtractionProposals.mock.calls[0]!
    expect(proposals).toHaveLength(1)
  })

  it('deux clauses distinctes sur la MÊME page (fenêtres différentes) → deux propositions (la dédup ne se fie jamais à la page seule)', async () => {
    const SAME_PAGE_TWO_CLAUSES = [
      '[[page 2]]',
      'Le prestataire assure un nettoyage quotidien des sanitaires du site. ',
      'Un rapport d\'intervention est remis au client à chaque visite du technicien.',
    ].join('\n')
    extractPdfTextResult = { text: SAME_PAGE_TWO_CLAUSES, pageCount: 1, charCount: SAME_PAGE_TWO_CLAUSES.length, isLikelyScanned: false }
    pageWindowsOverride = [
      { index: 0, pages: [2], text: SAME_PAGE_TWO_CLAUSES },
      { index: 1, pages: [2], text: SAME_PAGE_TWO_CLAUSES },
    ]
    runEngagementCandidateExtractionAgent
      .mockImplementationOnce(async () => ({
        candidates: [candidate({ label: 'Nettoyage', sourceExcerpt: 'Le prestataire assure un nettoyage quotidien des sanitaires du site.' })],
        metadata: {},
      }))
      .mockImplementationOnce(async () => ({
        candidates: [candidate({ label: 'Rapport', sourceExcerpt: 'Un rapport d\'intervention est remis au client à chaque visite du technicien.' })],
        metadata: {},
      }))

    const r = await extractEngagementCandidates(DOC_ID, 'user-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposalCount).toBe(2)
    const [, proposals] = insertExtractionProposals.mock.calls[0]!
    expect((proposals as Array<{ label: string; source_page: number | null }>).map((p) => p.label).sort())
      .toEqual(['Nettoyage', 'Rapport'])
    expect((proposals as Array<{ source_page: number | null }>).every((p) => p.source_page === 2)).toBe(true)
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
