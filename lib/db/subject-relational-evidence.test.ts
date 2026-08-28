// Tests V2 — extractRelationalEvidence (fonction pure, sans DB).
// Doctrine : conserver la phrase relationnelle rattachée aux sujets MENTIONNÉS (≥1), sans jamais
// fabriquer de faux subject_ids pour atteindre 2 sujets. Preuve ≠ relation.

import { describe, it, expect } from 'vitest'
import { extractRelationalEvidence, type RelSubject, type RelSource } from './subject-relational-evidence'

const SUBJECTS: RelSubject[] = [
  { id: 's-panneaux', label: 'Nettoyage panneaux isothermes (chambres froides)' },
  { id: 's-carrelage', label: 'Nettoyage du carrelage' },
  { id: 's-elec', label: 'Installations électriques' },
  { id: 's-hotte', label: 'Hotte cuisine' },
  { id: 's-alim', label: 'Alimentation électrique' },
]

describe('extractRelationalEvidence', () => {
  it('témoin carrelage : conserve la phrase, rattachée aux 2 sujets mentionnés', () => {
    const sources: RelSource[] = [{ text: 'Le nettoyage du carrelage sera remplacé par un nettoyage complet des panneaux isothermes.', sourceProposalId: 'p1' }]
    const ev = extractRelationalEvidence(sources, SUBJECTS)
    expect(ev).toHaveLength(1)
    expect(ev[0].evidenceText).toContain('remplacé')
    expect(ev[0].subjectIds.sort()).toEqual(['s-carrelage', 's-panneaux'])
    expect(ev[0].sourceProposalId).toBe('p1')
  })

  it('témoin hotte/alim : dépendance conservée avec les 2 sujets', () => {
    const ev = extractRelationalEvidence(
      [{ text: 'Impossible de terminer la hotte tant que l\'alimentation électrique n\'est pas reprise.' }],
      SUBJECTS,
    )
    expect(ev).toHaveLength(1)
    expect(ev[0].subjectIds.sort()).toEqual(['s-alim', 's-hotte'])
  })

  it('ne persiste PAS une phrase relationnelle sans sujet rattachable', () => {
    const ev = extractRelationalEvidence(
      [{ text: 'Si les produits sont repris, cela empêcherait la revégétalisation des décharges.' }],
      SUBJECTS, // aucun de ces sujets n'apparaît
    )
    expect(ev).toHaveLength(0)
  })

  it('ne fabrique jamais de faux sujet : 1 seul sujet mentionné → subject_ids de taille 1', () => {
    const ev = extractRelationalEvidence(
      [{ text: 'La mise en conformité nécessite une reprise des installations électriques.' }],
      SUBJECTS,
    )
    expect(ev).toHaveLength(1)
    expect(ev[0].subjectIds).toEqual(['s-elec'])
  })

  it('ignore les phrases SANS marqueur relationnel', () => {
    const ev = extractRelationalEvidence(
      [{ text: 'Le nettoyage des panneaux isothermes a été réalisé cette semaine.' }],
      SUBJECTS,
    )
    expect(ev).toHaveLength(0)
  })

  it('dédup : la même phrase dans deux sources ne produit qu\'une preuve', () => {
    const ev = extractRelationalEvidence(
      [
        { text: 'Impossible de terminer la hotte tant que l\'alimentation électrique n\'est pas reprise.', sourceProposalId: 'a' },
        { text: 'Impossible de terminer la hotte tant que l\'alimentation électrique n\'est pas reprise.', sourceProposalId: 'b' },
      ],
      SUBJECTS,
    )
    expect(ev).toHaveLength(1)
  })

  it('borne la taille de l\'evidence_text', () => {
    const long = 'La hotte nécessite l\'alimentation électrique ' + 'x'.repeat(1000)
    const ev = extractRelationalEvidence([{ text: long }], SUBJECTS)
    expect(ev[0].evidenceText.length).toBeLessThanOrEqual(500)
  })
})
