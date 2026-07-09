// FENÊTRE DE PREUVE — tests PURS (aucune DB, joués en CI).
// Doctrine testée : la preuve a une date limite de capture ; précision >> rappel
// (le lexique étroit ne matche pas les intitulés ambigus) ; fondé sur faits
// déclarés (dates hors horizon = silence) ; wording calme avec le POURQUOI.

import { describe, it, expect } from 'vitest'
import { occlusionTerm, buildProofWindowSignal, type ProofWindowCandidate } from '@/lib/proof-window'

const ASOF = '2026-07-09'

function cand(label: string, date: string, origin: 'intervention' | 'action' = 'intervention', id = 'x'): ProofWindowCandidate {
  return { id, label, date, origin }
}

describe('occlusionTerm — lexique de recouvrement (précision >> rappel)', () => {
  it('matche les travaux qui recouvrent, accents et casse ignorés', () => {
    expect(occlusionTerm('Coulage dalle zone B')).toBe('coulage')
    expect(occlusionTerm('Pose du DOUBLAGE placo R+1')).toBe('doublage')
    expect(occlusionTerm('Remblaiement tranchée EU')).toBe('remblai') // préfixe : « remblai » couvre « remblaiement »
    expect(occlusionTerm('Faux plafond hall d’accueil')).toBe('faux plafond')
    expect(occlusionTerm('Ragréage sol local technique')).toBe('ragreage')
  })

  it('ne matche PAS les intitulés ambigus ou hors sujet (faux signal = confiance perdue)', () => {
    expect(occlusionTerm('Réunion de chantier hebdo')).toBeNull()
    expect(occlusionTerm('Nettoyage de la dalle')).toBeNull() // « dalle » seul : exclu du lexique
    expect(occlusionTerm('Reprise écoulement EP')).toBeNull() // « écoulement » ≠ « coulage »
    expect(occlusionTerm('Fermeture du chantier pour congés')).toBeNull()
  })
})

describe('buildProofWindowSignal — fenêtres qui se referment', () => {
  it('null si aucun candidat ne matche (le silence est le défaut)', () => {
    expect(buildProofWindowSignal([cand('Réunion de chantier', '2026-07-10')], 0, ASOF)).toBeNull()
    expect(buildProofWindowSignal([], 0, ASOF)).toBeNull()
  })

  it('ignore les événements hors horizon (fait déclaré trop lointain) et passés', () => {
    expect(buildProofWindowSignal([cand('Coulage dalle', '2026-07-20')], 0, ASOF, 7)).toBeNull()
    expect(buildProofWindowSignal([cand('Coulage dalle', '2026-07-01')], 0, ASOF, 7)).toBeNull()
  })

  it('signale un coulage prévu sous 7 jours, trié par urgence, avec le POURQUOI', () => {
    const s = buildProofWindowSignal(
      [cand('Pose doublage R+1', '2026-07-14', 'action', 'a1'), cand('Coulage dalle zone B', '2026-07-11', 'intervention', 'i1')],
      0,
      ASOF,
    )
    expect(s).not.toBeNull()
    expect(s!.kind).toBe('proof_window_closing')
    expect(s!.title).toContain('2 fenêtres de preuve')
    expect(s!.items[0].id).toBe('i1') // le plus proche d'abord
    expect(s!.items[0].meta).toContain('recouvrement : coulage')
    expect(s!.items[0].context?.[0]).toContain('AVANT le 11/07/2026')
    expect(s!.source).toContain('physiquement impossible')
  })

  it("aujourd'hui / demain : wording humain, pas de date froide", () => {
    const s = buildProofWindowSignal([cand('Coulage dalle', ASOF)], 0, ASOF)
    expect(s!.items[0].meta).toContain("aujourd'hui")
    const s2 = buildProofWindowSignal([cand('Coulage dalle', '2026-07-10')], 0, ASOF)
    expect(s2!.items[0].meta).toContain('demain')
  })

  it('croise avec les réserves ouvertes (question, jamais affirmation localisée)', () => {
    const s = buildProofWindowSignal([cand('Coulage dalle', '2026-07-11')], 3, ASOF)
    const ctx = s!.items[0].context?.join(' ') ?? ''
    expect(ctx).toContain('3 réserves encore ouvertes')
    expect(ctx).toContain('?') // on questionne, on n’affirme pas la localisation
  })
})
