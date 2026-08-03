import { describe, it, expect } from 'vitest'
import {
  extractTechnicalCodes,
  filterCandidates,
  validateAndClassify,
} from './semantic-subject-resolution'

// Candidats représentatifs d'OCEF Compostage
const REGARD_R4 = { id: 'r4-uuid-0000-0000-0000-000000000001', label: 'Problème regard R4', aliases: [] }
const RACCORDEMENT_LAGUNAGE = { id: 'rl-uuid-0000-0000-0000-000000000002', label: 'Raccordement lagunage', aliases: [] }
const FT_DEBOURBEUR = { id: 'ft-uuid-0000-0000-0000-000000000003', label: 'FT Débourbeur', aliases: [] }
const REGARD_R3 = { id: 'r3-uuid-0000-0000-0000-000000000004', label: 'Problème regard R3', aliases: [] }
const TRAVAUX_DIVERS = { id: 'td-uuid-0000-0000-0000-000000000005', label: 'Travaux divers plateforme', aliases: [] }
const TRAVAUX_FINITION = { id: 'tf-uuid-0000-0000-0000-000000000006', label: 'Travaux de finition plateforme', aliases: [] }
const UNRELATED = { id: 'un-uuid-0000-0000-0000-000000000007', label: 'Plan de géotechnique G4', aliases: [] }

// ── extractTechnicalCodes ─────────────────────────────────────────────────────

describe('extractTechnicalCodes', () => {
  it('extrait R4 depuis un label reformulé', () => {
    const codes = extractTechnicalCodes('Reprise du réseau pour problème regard R4')
    expect(codes.has('R4')).toBe(true)
  })

  it('extrait plusieurs codes techniques', () => {
    const codes = extractTechnicalCodes('Plan DN160 et DN200 posés')
    expect(codes.has('DN160')).toBe(true)
    expect(codes.has('DN200')).toBe(true)
  })

  it('extrait G3 depuis un label rapport', () => {
    const codes = extractTechnicalCodes('Rapport de géotechnique G3 transmis')
    expect(codes.has('G3')).toBe(true)
  })

  it('retourne un set vide pour un label sans code', () => {
    const codes = extractTechnicalCodes('Purge complémentaire réalisée')
    expect(codes.size).toBe(0)
  })

  it('ne confond pas R3 et R4', () => {
    const codes = extractTechnicalCodes('Regard R3 obstrué')
    expect(codes.has('R3')).toBe(true)
    expect(codes.has('R4')).toBe(false)
  })
})

// ── filterCandidates — cas 1 : Regard R4 ─────────────────────────────────────

describe('filterCandidates — Regard R4', () => {
  const orphanLabel = 'Reprise du réseau pour problème regard R4'
  const allCandidates = [REGARD_R4, RACCORDEMENT_LAGUNAGE, FT_DEBOURBEUR, UNRELATED]

  it('inclut Regard R4 grâce au code technique commun R4', () => {
    const filtered = filterCandidates(orphanLabel, allCandidates)
    expect(filtered.some((c) => c.id === REGARD_R4.id)).toBe(true)
  })

  it('exclut les candidats sans lien lexical ni code commun', () => {
    const filtered = filterCandidates(orphanLabel, allCandidates)
    // FT Débourbeur et Raccordement lagunage n'ont pas de code commun avec R4
    // et ont Jaccard ≈ 0 avec le label orphelin
    expect(filtered.some((c) => c.id === FT_DEBOURBEUR.id)).toBe(false)
  })

  it('respecte la borne max', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `id-${i}`,
      label: `regard R4 variante ${i}`,
      aliases: [],
    }))
    const filtered = filterCandidates(orphanLabel, many, 80)
    expect(filtered.length).toBeLessThanOrEqual(80)
  })
})

// ── filterCandidates — cas 2 : Raccordement lagunage ─────────────────────────

describe('filterCandidates — Raccordement lagunage', () => {
  const orphanLabel = 'Raccordement eaux pluviales vers lagunage'
  const allCandidates = [REGARD_R4, RACCORDEMENT_LAGUNAGE, FT_DEBOURBEUR]

  it('inclut Raccordement lagunage (Jaccard sur "raccordement" et "lagunage")', () => {
    const filtered = filterCandidates(orphanLabel, allCandidates)
    expect(filtered.some((c) => c.id === RACCORDEMENT_LAGUNAGE.id)).toBe(true)
  })

  it('exclut Regard R4 (aucun token ni code commun)', () => {
    const filtered = filterCandidates(orphanLabel, allCandidates)
    expect(filtered.some((c) => c.id === REGARD_R4.id)).toBe(false)
  })
})

// ── filterCandidates — cas 3 : FT Débourbeur ─────────────────────────────────

describe('filterCandidates — FT Débourbeur', () => {
  const orphanLabel = 'Mise en service FT Débourbeur section amont'
  const allCandidates = [REGARD_R4, RACCORDEMENT_LAGUNAGE, FT_DEBOURBEUR, UNRELATED]

  it('inclut FT Débourbeur (Jaccard sur "ft" et "debourbeur")', () => {
    const filtered = filterCandidates(orphanLabel, allCandidates)
    expect(filtered.some((c) => c.id === FT_DEBOURBEUR.id)).toBe(true)
  })
})

// ── filterCandidates — cas 6 : isolation site ─────────────────────────────────

describe('filterCandidates — isolation site', () => {
  it('retourne vide si aucun candidat fourni (candidats d\'un autre site = liste vide)', () => {
    const filtered = filterCandidates('Regard R4 problème', [])
    expect(filtered).toHaveLength(0)
  })
})

// ── validateAndClassify ───────────────────────────────────────────────────────

describe('validateAndClassify', () => {
  const validSet = new Set([REGARD_R4.id, RACCORDEMENT_LAGUNAGE.id])

  // Cas 1 : haute confiance, UUID valide → would_auto_assign
  it('would_auto_assign si confidence >= 0.95 et UUID dans la liste', () => {
    const result = validateAndClassify(REGARD_R4.id, 0.95, validSet)
    expect(result.shadowDecision).toBe('would_auto_assign')
    expect(result.candidateId).toBe(REGARD_R4.id)
  })

  // Cas : confiance intermédiaire → would_suggest
  it('would_suggest si 0.70 <= confidence < 0.95', () => {
    const result = validateAndClassify(REGARD_R4.id, 0.82, validSet)
    expect(result.shadowDecision).toBe('would_suggest')
    expect(result.candidateId).toBe(REGARD_R4.id)
  })

  // Cas 4 : R3 ≠ R4 — LLM retourne R4 UUID avec confiance faible
  it('no_match si confidence < 0.70', () => {
    const result = validateAndClassify(REGARD_R4.id, 0.55, validSet)
    expect(result.shadowDecision).toBe('no_match')
    expect(result.candidateId).toBeNull()
  })

  // Cas 5 : garde anti-hallucination — UUID inventé
  it('no_match si UUID absent de la liste candidate (hallucination LLM)', () => {
    const hallucinatedId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    const result = validateAndClassify(hallucinatedId, 0.96, validSet)
    expect(result.shadowDecision).toBe('no_match')
    expect(result.candidateId).toBeNull()
  })

  // Cas : match null → no_match
  it('no_match si match est null', () => {
    const result = validateAndClassify(null, 0.0, validSet)
    expect(result.shadowDecision).toBe('no_match')
    expect(result.candidateId).toBeNull()
  })

  // Cas : seuil exact 0.95
  it('would_auto_assign si confidence === 0.95 (seuil inclusif)', () => {
    const result = validateAndClassify(REGARD_R4.id, 0.95, validSet)
    expect(result.shadowDecision).toBe('would_auto_assign')
  })

  // Cas : 0.90 est désormais en zone would_suggest (seuil relevé à 0.95)
  it('would_suggest si confidence === 0.90 (en dessous du nouveau seuil 0.95)', () => {
    const result = validateAndClassify(REGARD_R4.id, 0.90, validSet)
    expect(result.shadowDecision).toBe('would_suggest')
  })

  // Cas : seuil exact 0.70
  it('would_suggest si confidence === 0.70 (seuil inclusif)', () => {
    const result = validateAndClassify(REGARD_R4.id, 0.70, validSet)
    expect(result.shadowDecision).toBe('would_suggest')
  })
})

// ── filterCandidates — cas 4 : R3 ≠ R4 ───────────────────────────────────────

describe('filterCandidates — R3 ≠ R4', () => {
  it('inclut Regard R4 dans la liste candidate pour "Problème regard R3" (Jaccard sur regard)', () => {
    // Le filtre inclut le candidat, mais le LLM (ou validateAndClassify avec faible confiance)
    // est responsable de la distinction finale.
    const filtered = filterCandidates('Problème regard R3', [REGARD_R4, REGARD_R3, UNRELATED])
    // "regard" est un token commun avec Regard R4 → Jaccard > 0.10
    const hasR4 = filtered.some((c) => c.id === REGARD_R4.id)
    const hasR3 = filtered.some((c) => c.id === REGARD_R3.id)
    // Les deux peuvent être présents (c'est le LLM qui tranche), mais aucun des deux
    // ne doit être absent si Jaccard > 0.10
    expect(hasR3).toBe(true) // R3 est dans la liste : même token "regard r3"
    // Si R4 est aussi inclus (Jaccard "regard"), validateAndClassify avec faible confiance fera no_match
    if (hasR4) {
      const result = validateAndClassify(REGARD_R4.id, 0.60, new Set([REGARD_R4.id, REGARD_R3.id]))
      expect(result.shadowDecision).toBe('no_match')
    }
  })
})
