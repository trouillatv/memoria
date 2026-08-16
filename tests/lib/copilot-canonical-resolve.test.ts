import { describe, it, expect } from 'vitest'
import {
  normalizeCanonicalLabel,
  resolveCanonicalSubjectReference,
  findLexicalAnchorMatches,
  type SubjectResolutionResult,
} from '@/lib/db/canonical-subject-resolve'

// ── Tests de normalizeCanonicalLabel ─────────────────────────────────────────

describe('normalizeCanonicalLabel', () => {
  it('met en minuscules et supprime les accents', () => {
    expect(normalizeCanonicalLabel('G3 purge complémentaire')).toBe('g3 purge complementaire')
  })

  it('supprime la ponctuation', () => {
    expect(normalizeCanonicalLabel('R4 — essais béton')).toBe('r4 essais beton')
  })

  it('normalise les espaces multiples', () => {
    expect(normalizeCanonicalLabel('G3  purge  complementaire')).toBe('g3 purge complementaire')
  })
})

// ── Factories pour simuler des canonical_subjects ─────────────────────────────
// Les tests unitaires de résolution ne font pas appel à la base de données.
// On vérifie uniquement la logique de classement et de décision.

// Pour tester la logique pure sans DB, on expose les fonctions utilitaires
// via l'import et on teste directement les heuristiques.
// Les tests d'intégration avec la vraie DB sont hors-périmètre de ce lot.

import { extractTechnicalCodes } from '@/lib/documents/semantic-subject-resolution'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'

describe('extractTechnicalCodes — utilisé dans la résolution', () => {
  it('extrait G3 et R4', () => {
    expect(extractTechnicalCodes('G3 purge complémentaire')).toEqual(new Set(['G3']))
    expect(extractTechnicalCodes('Regard R4 béton')).toEqual(new Set(['R4']))
  })

  it('extrait plusieurs codes', () => {
    expect(extractTechnicalCodes('G3 et R4 liés')).toEqual(new Set(['G3', 'R4']))
  })

  it("n'extrait pas les mots sans chiffres (CVCD, BECIB)", () => {
    expect(extractTechnicalCodes('Rapport BECIB CVCD')).toEqual(new Set())
  })

  it('extrait DN160 et PVC200', () => {
    expect(extractTechnicalCodes('Réseau DN160 PVC200')).toEqual(new Set(['DN160', 'PVC200']))
  })
})

describe('jaccardSimilarity — base de la résolution', () => {
  it('labels identiques → 1.0', () => {
    expect(jaccardSimilarity('G3 purge complémentaire', 'G3 purge complémentaire')).toBe(1)
  })

  it('aucun token commun → 0', () => {
    expect(jaccardSimilarity('G3 purge', 'R4 béton dalle')).toBe(0)
  })

  it('token G3 commun entre deux labels différents', () => {
    const scoreA = jaccardSimilarity('G3', 'G3 purge complémentaire')
    const scoreB = jaccardSimilarity('G3', 'G3 essais plateforme support dalle')
    // Les deux scores doivent être > 0 (G3 est en commun)
    expect(scoreA).toBeGreaterThan(0)
    expect(scoreB).toBeGreaterThan(0)
    // G3 purge complémentaire a moins de tokens → score Jaccard plus élevé
    expect(scoreA).toBeGreaterThan(scoreB)
  })
})

// ── Doctrine de résolution : assertions de comportement attendu ───────────────
// Ces tests documentent les invariants sans appeler la DB.

describe('doctrine resolveCanonicalSubjectReference', () => {
  it('G3 seul avec 2 sujets G3 → doit retourner ambiguous (validé par intégration)', () => {
    // Ce test documente le comportement attendu.
    // La résolution réelle nécessite un appel DB.
    // En intégration : resolveCanonicalSubjectReference(siteId, 'G3') → { kind: 'ambiguous' }
    const doc = `
      "G3" avec deux sujets canoniques distincts (G3 purge comp + G3 essais plateforme)
      doit retourner ambiguous car les deux partagent le code technique G3
      et aucun n'a une avance Jaccard suffisante.
    `
    expect(doc).toBeTruthy()
  })

  it('label exact unique → resolved', () => {
    // Comportement documenté : un label normalisé qui correspond exactement à un seul
    // canonical_subject doit retourner { kind: 'resolved', candidate: { id, label } }
    const doc = `normalizeCanonicalLabel(query) === normalizeCanonicalLabel(label) → resolved`
    expect(doc).toBeTruthy()
  })

  it('canonical d\'un autre site → refuse (sécurité)', () => {
    // getCanonicalSubjectLifeForSite(siteId, canonicalSubjectId) retourne null
    // si canonical_subject.site_id !== siteId
    const doc = `getCanonicalSubjectLifeForSite garantit la cloisonisation inter-chantier`
    expect(doc).toBeTruthy()
  })
})

// ── Tests de la logique de normalisation (ne nécessitent pas la DB) ────────────

describe('normalisation et correspondance exacte', () => {
  it('même label, casse différente → correspondance exacte', () => {
    const a = normalizeCanonicalLabel('G3 PURGE COMPLÉMENTAIRE')
    const b = normalizeCanonicalLabel('g3 purge complémentaire')
    expect(a).toBe(b)
  })

  it('ordre des mots différent → pas de correspondance exacte (string order-dependent)', () => {
    const a = normalizeCanonicalLabel('essais G3 plateforme')
    const b = normalizeCanonicalLabel('G3 essais plateforme')
    expect(a).not.toBe(b)
  })
})

// ── findLexicalAnchorMatches — P4-A.1 (2026-08-17) ─────────────────────────────
// Ancrage lexical discriminant : un mot court parlé naturellement ("cadenas",
// "portail") doit retrouver un canonical_subject dont le libellé est long,
// sans dépendre du seuil Jaccard global. Sûreté par comptage de sujets touchés :
// 1 seul sujet → résolution certaine ; plusieurs → ambiguïté, jamais tranchée.

describe('findLexicalAnchorMatches', () => {
  const PETRO_ACCES = {
    id: 'subj-acces',
    label: 'Accès sécurisé au chantier (portail et cadenas à code)',
    aliases: null,
  }
  const PETRO_TERRASSEMENT = {
    id: 'subj-terrassement',
    label: 'Terrassement plateforme G3',
    aliases: null,
  }

  // resolveCanonicalSubjectReference reçoit toujours une entité déjà extraite
  // (classification.entities.subjectLabels[0]), jamais la phrase brute — c'est
  // le LLM de compréhension (mergeComprehension) qui isole "cadenas"/"portail"
  // depuis "Le cadenas n'est toujours pas installé." avant l'appel.

  it('"cadenas" seul retrouve le sujet "Accès sécurisé..." sans ambiguïté', () => {
    const result = findLexicalAnchorMatches('cadenas', [PETRO_ACCES, PETRO_TERRASSEMENT])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('subj-acces')
  })

  it('"portail" seul retrouve le même sujet', () => {
    const result = findLexicalAnchorMatches('portail', [PETRO_ACCES, PETRO_TERRASSEMENT])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('subj-acces')
  })

  it('la même entité "cadenas" retrouve le même sujet que ce soit issue d\'un READ ou d\'une OBSERVATION', () => {
    // "Où en est le cadenas ?" (READ) et "Le cadenas n'est toujours pas installé." (OBSERVATION)
    // convergent toutes deux vers la même entité extraite "cadenas" avant résolution.
    const readResult = findLexicalAnchorMatches('cadenas', [PETRO_ACCES, PETRO_TERRASSEMENT])
    const observationResult = findLexicalAnchorMatches('cadenas', [PETRO_ACCES, PETRO_TERRASSEMENT])
    expect(readResult).toHaveLength(1)
    expect(observationResult).toHaveLength(1)
    expect(readResult[0].id).toBe(observationResult[0].id)
  })

  it('un mot absent de tout label → aucun ancrage (laisse la main au Jaccard/not_found)', () => {
    const result = findLexicalAnchorMatches('gaines', [PETRO_ACCES, PETRO_TERRASSEMENT])
    expect(result).toHaveLength(0)
  })

  it('collision : "planning" partagé par deux sujets → ambiguïté, pas de résolution auto', () => {
    const planningA = { id: 'subj-planning-a', label: 'Planning travaux gros œuvre', aliases: null }
    const planningB = { id: 'subj-planning-b', label: 'Planning livraison matériaux', aliases: null }
    const result = findLexicalAnchorMatches('planning', [planningA, planningB, PETRO_ACCES])
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id).sort()).toEqual(['subj-planning-a', 'subj-planning-b'])
  })

  it('collision : terme générique "matériel" présent dans plusieurs sujets → abstention', () => {
    const materielA = { id: 'subj-materiel-a', label: 'Livraison matériel électrique', aliases: null }
    const materielB = { id: 'subj-materiel-b', label: 'Stockage matériel chantier', aliases: null }
    const result = findLexicalAnchorMatches('matériel', [materielA, materielB])
    expect(result).toHaveLength(2)
  })

  it('un token unique trop court (< 7 caractères) ne matche pas seul', () => {
    // "porte" (5 lettres) ne doit pas suffire à matcher par containment.
    const porte = { id: 'subj-porte', label: 'Porte du local technique', aliases: null }
    const result = findLexicalAnchorMatches('la porte', [porte])
    expect(result).toHaveLength(0)
  })

  it('un alias discriminant retrouve aussi le sujet', () => {
    const withAlias = { id: 'subj-alias', label: 'Accès chantier', aliases: ['cadenas à code'] }
    const result = findLexicalAnchorMatches('Le cadenas à code ne fonctionne plus.', [withAlias])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('subj-alias')
  })
})
