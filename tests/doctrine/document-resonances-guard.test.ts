// B1 — résonances documentaires déterministes : tests purs (matchers) +
// garde-fous structurels (tripwires) sur lib/documents/resonances.ts.
//
// Spec : docs/superpowers/specs/2026-05-20-niveau-b-documents-memoire-
//        relationnelle.md.
//
// Doctrine couverte ici :
//  - zéro LLM / orchestrateur / generateText importé ;
//  - filtres AND visibility ∈ {operations, field} ET types autorisés ;
//  - 2 sources OBLIGATOIRES dans source_ids ;
//  - algorithm_version namespacé `b1_doc_*` ;
//  - ≤3 résonances B1 par site (plafond) ;
//  - reading_type='resonance' (pas de nouveau type, pas de migration).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bigramsOf,
  findCommonBigrams,
  normalizeWord,
  significantWords,
  B1_ALGO_ACCESS,
  B1_ALGO_PROCEDURE,
  B1_DOC_TYPES_ACCESS,
  B1_DOC_TYPES_PROCEDURE,
  B1_VISIBILITY_ALLOWED,
  B1_MAX_PER_SITE,
  B1_EXPIRE_DAYS,
} from '@/lib/documents/resonance-matchers'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

// =============================================================================
// Matchers purs — déterminisme et limites
// =============================================================================

describe('B1 matchers — normalisation', () => {
  it('lowercase + diacritiques retirés (stable)', () => {
    expect(normalizeWord('Éléphant')).toBe('elephant')
    expect(normalizeWord('PROCÉDURE')).toBe('procedure')
    expect(normalizeWord('café')).toBe('cafe')
  })

  it('idempotent : normalize(normalize(x)) === normalize(x)', () => {
    const samples = ['Élève', 'naïve', 'PROCÉDURE', 'cafe']
    for (const s of samples) {
      const once = normalizeWord(s)
      expect(normalizeWord(once)).toBe(once)
    }
  })
})

describe('B1 matchers — significantWords', () => {
  it('filtre stopwords FR + mots <3 chars', () => {
    const words = significantWords('Le chef a vu une procédure dans la salle')
    expect(words).toContain('chef')
    expect(words).toContain('procedure')
    expect(words).toContain('salle')
    expect(words).not.toContain('le')
    expect(words).not.toContain('la')
    expect(words).not.toContain('a')
  })

  it('split sur ponctuation et chiffres mixtes', () => {
    const words = significantWords('Couloir A1, escalier-secondaire ; PC sécurité.')
    expect(words.length).toBeGreaterThan(0)
    expect(words.every((w) => /^[\p{L}\p{N}]+$/u.test(w))).toBe(true)
  })
})

describe('B1 matchers — bigramsOf / findCommonBigrams', () => {
  it('bigramsOf : paires consécutives de mots significatifs', () => {
    const bg = bigramsOf('PC sécurité couloir A1')
    expect(bg.has('pc securite')).toBe(true)
    expect(bg.has('securite couloir')).toBe(true)
  })

  it('findCommonBigrams : retourne tous les bigrammes communs', () => {
    const doc = 'Procédure ouverture PC sécurité côté Nord du site'
    const note = 'Hier le PC sécurité côté Nord n\'était pas accessible'
    const common = findCommonBigrams(doc, note)
    expect(common.length).toBeGreaterThan(0)
    expect(common).toContain('pc securite')
  })

  it('ordre stable (tri alpha) — déterminisme', () => {
    const a = 'zebre alpha beta gamma'
    const b = 'gamma beta alpha zebre'
    // Les bigrammes communs : aucun (ordre différent), test stabilité du tri
    const t1 = findCommonBigrams('alpha beta gamma delta', 'gamma delta alpha beta')
    const t2 = findCommonBigrams('alpha beta gamma delta', 'gamma delta alpha beta')
    expect(t1).toEqual(t2)
    // Bigrammes triés alpha
    const sorted = [...t1].sort()
    expect(t1).toEqual(sorted)
    // Sanity : pas un bigramme isolé (un seul mot commun ne suffit pas)
    expect(findCommonBigrams('chef', 'chef').length).toBe(0)
    // a, b utilisés pour démontrer absence de match malgré mots partagés
    expect(findCommonBigrams(a, b)).toEqual([])
  })

  it('faux-lien sémantique évité : un mot isolé partagé ≠ bigramme', () => {
    // « eau » apparaît dans les deux mais aucun bigramme commun.
    const doc = 'Procédure eau javel diluée'
    const note = 'Eau partout dans le couloir'
    expect(findCommonBigrams(doc, note)).toEqual([])
  })
})

describe('B1 matchers — constantes doctrinales', () => {
  it('types acceptés excluent les juridiques', () => {
    const allowed = [...B1_DOC_TYPES_ACCESS, ...B1_DOC_TYPES_PROCEDURE]
    for (const t of ['contrat', 'avenant', 'litige', 'facture', 'memoire_technique', 'ao']) {
      expect(allowed.includes(t as never), `${t} doit être exclu B1`).toBe(false)
    }
    expect(allowed).toContain('plan_acces')
    expect(allowed).toContain('securite')
    expect(allowed).toContain('procedure')
    expect(allowed).toContain('protocole')
  })

  it('visibility autorisée = operations/field uniquement (jamais admin_only/manager)', () => {
    expect([...B1_VISIBILITY_ALLOWED]).toEqual(['operations', 'field'])
  })

  it('plafond par site = 3 (raffinement Vincent anti-bruit)', () => {
    expect(B1_MAX_PER_SITE).toBe(3)
  })

  it('expires_at = 30 jours', () => {
    expect(B1_EXPIRE_DAYS).toBe(30)
  })

  it('algorithm_version namespacé b1_doc_*', () => {
    expect(B1_ALGO_ACCESS.startsWith('b1_doc_')).toBe(true)
    expect(B1_ALGO_PROCEDURE.startsWith('b1_doc_')).toBe(true)
  })
})

// =============================================================================
// Tripwires structurels sur lib/documents/resonances.ts
// =============================================================================

describe('B1 — garde-fous structurels (resonances.ts)', () => {
  const src = read('lib/documents/resonances.ts')

  it('aucun import IA / LLM / orchestrateur / agent', () => {
    expect(
      /@anthropic-ai|@google\/genai|generateText|services\/ai\/orchestrator|services\/ai\/agents\/|services\/ai\/chat/.test(src),
      'B1 doit rester déterministe (aucun appel génératif)',
    ).toBe(false)
  })

  it('aucun appel d\'embedding / RPC vectoriel supplémentaire', () => {
    expect(/embedDocumentChunks|embedQuery|find_similar_|matchAoToKnowledge/.test(src)).toBe(false)
  })

  it('aucune écriture de score dans le fragment ou source_ids', () => {
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/internal_score|confidence|score:\s*\d/.test(codeOnly)).toBe(false)
  })

  it('reading_type=resonance figé (pas de nouveau type)', () => {
    expect(src).toContain("reading_type: 'resonance'")
    expect(/reading_type:\s*'(?!resonance')/m.test(src)).toBe(false)
  })

  it('algorithm_version namespacé b1_doc_*', () => {
    expect(/algorithm_version:\s*B1_ALGO_(ACCESS|PROCEDURE)/.test(src)).toBe(true)
  })

  it('2 sources obligatoires (document + access_event|site_note)', () => {
    // Recherche des 2 patrons explicites dans le fichier
    expect(src).toContain("type: 'document'")
    expect(/type:\s*'access_event'/.test(src) || /type:\s*'site_note'/.test(src)).toBe(true)
  })

  it('filtre visibility ∈ operations/field appliqué (défense en profondeur)', () => {
    expect(/B1_VISIBILITY_ALLOWED[\s\S]{0,80}?includes\(d\.visibility_level\)/.test(src)).toBe(true)
  })

  it('filtre type ∈ types autorisés appliqué', () => {
    expect(/allTypes\.includes\(d\.document_type\)/.test(src)).toBe(true)
  })

  it('filtre document_links target_type=site appliqué', () => {
    expect(src).toContain("target_type")
    expect(src).toContain("'site'")
    expect(/from\('document_links'\)/.test(src)).toBe(true)
  })

  it('plafond ≤ B1_MAX_PER_SITE appliqué', () => {
    expect(/all\.length\s*>\s*B1_MAX_PER_SITE/.test(src)).toBe(true)
    expect(/like\('algorithm_version',\s*'b1_doc_%'\)/.test(src)).toBe(true)
  })

  it('expires_at calculé à B1_EXPIRE_DAYS jours', () => {
    expect(/B1_EXPIRE_DAYS\s*\*\s*86_?400_?000/.test(src)).toBe(true)
  })

  it('garde mock-safe inutile mais zéro recall live confirmé (aucun provider référencé)', () => {
    expect(/getProvider|aiProvider|provider\./.test(src)).toBe(false)
  })

  it('hook fire-and-forget dans analyze.ts (après status=ready)', () => {
    const analyze = read('lib/documents/analyze.ts')
    // L'ordre compte : 'ready' AVANT computeDocResonancesForDocument.
    const readyIdx = analyze.indexOf("updateDocumentAnalysisStatus(documentId, 'ready')")
    const resoIdx = analyze.indexOf('computeDocResonancesForDocument')
    expect(readyIdx).toBeGreaterThan(-1)
    expect(resoIdx).toBeGreaterThan(-1)
    expect(resoIdx).toBeGreaterThan(readyIdx)
    // Import dynamique (pattern A3) — garde le module server-only hors graphe.
    expect(/await import\(['"]\.\/resonances['"]\)/.test(analyze)).toBe(true)
  })

  it('dismiss action : status=dismissed + audit + auth manager+', () => {
    const action = read('app/(dashboard)/sites/[id]/resonance-actions.ts')
    expect(action).toContain("status: 'dismissed'")
    expect(action).toContain('logAuditEvent')
    expect(action).toContain('requireManagerOrAdmin')
    // Vérification site_id avant update (anti URL forgée).
    expect(/r\.site_id\s*!==\s*parsed\.data\.site_id/.test(action)).toBe(true)
  })
})
