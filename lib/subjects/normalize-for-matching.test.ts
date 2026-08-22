// Sentinel P0-1 — Tests déterministes de normalizeForMatching.
// Corpus de référence : OCEF 2c939e67 (audit Opus 4.8, docs/memory-longitudinal-v1/P0-1-OCEF-IDENTITY-STATE-AUDIT.md).
//
// Deux catégories :
//  SAME   → Jaccard(normalize(A), normalize(B)) ≥ P01_NORMALIZED_JACCARD_THRESHOLD (0.35)
//           = ces pairs DOIVENT générer un candidat P0-1
//  GUARD  → Jaccard(normalize(A), normalize(B)) < P01_NORMALIZED_JACCARD_THRESHOLD
//           = ces pairs NE DOIVENT PAS être confondues (COLL-1, COLL-3, COLL-4, COLL-6)

import { describe, test, expect } from 'vitest'
import { normalizeForMatching, P01_NORMALIZED_JACCARD_THRESHOLD } from './normalize-for-matching'
import { jaccardSimilarity } from '@/lib/documents/subject-reconciliation'

// Utilise le vrai jaccardSimilarity (avec filtrage stopwords) sur les formes normalisées,
// pour valider exactement le comportement de la pipeline réelle.
function jaccardOnNormalized(a: string, b: string): number {
  return jaccardSimilarity(normalizeForMatching(a), normalizeForMatching(b))
}

describe('normalizeForMatching — transformations atomiques', () => {
  test('retire le préfixe "Prévision :"', () => {
    expect(normalizeForMatching('Prévision : Couche de forme')).toBe('couche de forme')
  })
  test('retire le préfixe "Prévisionnel :"', () => {
    expect(normalizeForMatching('Prévisionnel : Terrassement')).toBe('terrassement')
  })
  test('retire "= Fait"', () => {
    expect(normalizeForMatching('Nivellement plateforme = Fait')).toBe('nivellement plateforme')
  })
  test('retire "= Réalisé"', () => {
    expect(normalizeForMatching('Couche de forme = Réalisé')).toBe('couche de forme')
  })
  test('retire "= Réalisée"', () => {
    expect(normalizeForMatching('Clôture = Réalisée')).toBe('cloture')
  })
  test('retire "- Travaux réalisés"', () => {
    expect(normalizeForMatching('Accès Plateforme - Travaux réalisés')).toBe('acces plateforme')
  })
  test('retire ": X réalisé(s)" quand X sans date', () => {
    expect(normalizeForMatching('Busage provisoire : Pose réalisée')).toBe('busage provisoire')
  })
  test('GARDE ": X réalisé(s)" quand X contient une date', () => {
    const n = normalizeForMatching('Essais Plateforme 20.02 Non Conformes')
    expect(n).toContain('20')
    expect(n).toContain('02')
  })
  test('retire clause "réalisé, reprise à faire..."', () => {
    expect(normalizeForMatching('Récolement réalisé, reprise à faire sur zones hors tolérance')).toBe('recolement')
  })
  test('retire clause ", reprise à faire" seule', () => {
    expect(normalizeForMatching('Accès plateforme, reprise à faire section nord')).toBe('acces plateforme')
  })
  test('normalise "Gestion des Eaux (GDE)" → "GDE"', () => {
    expect(normalizeForMatching('Gestion des Eaux (GDE) : Busage Provisoire')).toBe('gde busage provisoire')
  })
  test('normalise "Gestion des Eaux" sans parens → "GDE"', () => {
    expect(normalizeForMatching('Gestion des Eaux : Fossé')).toBe('gde fosse')
  })
  test('retire le préfixe catégoriel "Terrassement plateforme :"', () => {
    expect(normalizeForMatching('Terrassement plateforme : Couche de forme')).toBe('couche de forme')
  })

  test('GUARD COLL-5 : company — pas de normalisation sémantique', () => {
    const n = normalizeForMatching('Prévision : BECIB Coordination', 'company')
    expect(n).toContain('prevision')
  })
  test('GUARD COLL-5 : person — pas de normalisation sémantique', () => {
    const n = normalizeForMatching('Réalisé par M. Dupont', 'person')
    expect(n).toContain('realise')
  })
})

describe('normalizeForMatching — paires SAME (Jaccard ≥ 0.35)', () => {
  test('G4 Accès Plateforme : état vs noyau', () => {
    const score = jaccardOnNormalized('Accès Plateforme : Déblais réalisés', 'Accès Plateforme')
    expect(score).toBeGreaterThanOrEqual(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('G7 Récolement : clause réalisé + reprise vs noyau', () => {
    const score = jaccardOnNormalized(
      'Récolement réalisé, reprise à faire sur zones hors tolérance',
      'Récolement plateforme',
    )
    expect(score).toBeGreaterThanOrEqual(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('G5 Couche de forme : préfixe Prévision vs noyau', () => {
    const score = jaccardOnNormalized(
      'Prévision : Mise en place couche de forme',
      'Mise en place couche de forme (GNT)',
    )
    expect(score).toBeGreaterThanOrEqual(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('G2a GDE Busage : forme explicite vs abréviation', () => {
    const score = jaccardOnNormalized(
      'Gestion des Eaux (GDE) : Busage Provisoire',
      'GDE - Busage Provisoire',
    )
    expect(score).toBeGreaterThanOrEqual(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('G2b GDE Fossé : "Gestion des Eaux" sans parens vs "GDE"', () => {
    const score = jaccardOnNormalized('Gestion des Eaux : Fossé pluvial', 'GDE - Fossé pluvial')
    expect(score).toBeGreaterThanOrEqual(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('G3 Nivellement : "= Fait" vs noyau', () => {
    const score = jaccardOnNormalized('Nivellement plateforme = Fait', 'Nivellement plateforme')
    expect(score).toBeGreaterThanOrEqual(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('G6 Terrassement : préfixe catégoriel vs noyau', () => {
    const score = jaccardOnNormalized('Terrassement plateforme : Couche de forme GNT', 'Couche de forme GNT')
    expect(score).toBeGreaterThanOrEqual(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('G8 Récolement : "- Travaux réalisés" vs noyau', () => {
    const score = jaccardOnNormalized('Récolement plateforme - Travaux réalisés', 'Récolement plateforme')
    expect(score).toBeGreaterThanOrEqual(P01_NORMALIZED_JACCARD_THRESHOLD)
  })
})

describe('normalizeForMatching — paires GUARD (Jaccard < 0.35 — ne pas confondre)', () => {
  test('COLL-1 : GDE Busage vs GDE Fossé — localisations distinctes', () => {
    const score = jaccardOnNormalized('GDE - Busage Provisoire', 'GDE - Fossé pluvial')
    expect(score).toBeLessThan(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('COLL-3a : Essais dates différentes — dates conservées', () => {
    const score = jaccardOnNormalized(
      'Essais Plateforme 20.02 Non Conformes',
      'Essais plateforme du 30/03 conforme',
    )
    expect(score).toBeLessThan(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('COLL-4 : Intempéries épisodes différents — dates conservées', () => {
    const score = jaccardOnNormalized('Intempéries du 16/02 au 06/03', 'Intempéries du 24/03 au 26/03')
    expect(score).toBeLessThan(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('COLL-6 : Accès site vs Accès Plateforme — localisations distinctes', () => {
    const score = jaccardOnNormalized('Accès au site', 'Accès Plateforme')
    expect(score).toBeLessThan(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('COLL-2 : transmissions thématiques différentes — objets distincts', () => {
    const score = jaccardOnNormalized(
      'Transmettre les fiches techniques des matériaux',
      'Transmettre les relevés météo',
    )
    expect(score).toBeLessThan(P01_NORMALIZED_JACCARD_THRESHOLD)
  })

  test('GUARD lot : GDE Busage vs GDE (racine commune seule)', () => {
    const score = jaccardOnNormalized('GDE - Busage Provisoire', 'GDE')
    // "gde busage provisoire" vs "gde" → inter=1, union=3 → 0.33 < 0.35
    expect(score).toBeLessThan(P01_NORMALIZED_JACCARD_THRESHOLD)
  })
})
