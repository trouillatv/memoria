// FENÊTRE DE PREUVE — tests PURS (aucune DB, joués en CI).
// Doctrine testée : la preuve a une date limite de capture ; moteur MÉTIER
// (opération → conséquence physique → fenêtre), pas seulement lexical ;
// précision >> rappel (le lexique étroit ne matche pas les intitulés ambigus) ;
// fondé sur faits déclarés (dates hors horizon = silence) ; wording calme avec
// le POURQUOI.

import { describe, it, expect } from 'vitest'
import {
  occlusionMatch,
  buildProofWindowSignal,
  OCCLUSION_LEXICON,
  CONSEQUENCE_WORDING,
  type ProofWindowCandidate,
} from '@/lib/proof-window'

const ASOF = '2026-07-09'

function cand(label: string, date: string, origin: 'intervention' | 'action' = 'intervention', id = 'x'): ProofWindowCandidate {
  return { id, label, date, origin }
}

describe('occlusionMatch — opération → conséquence physique', () => {
  it('reconnaît l’opération ET sa conséquence, accents et casse ignorés', () => {
    expect(occlusionMatch('Coulage dalle zone B')).toEqual({ term: 'coulage', consequence: 'recouvre' })
    expect(occlusionMatch('Pose du DOUBLAGE placo R+1')).toEqual({ term: 'doublage', consequence: 'cache' })
    expect(occlusionMatch('Remblaiement tranchée EU')?.consequence).toBe('enterre')
    expect(occlusionMatch('Faux plafond hall d’accueil')).toEqual({ term: 'faux plafond', consequence: 'cache' })
    expect(occlusionMatch('Rebouchage réservations gaine')).toEqual({ term: 'rebouchage', consequence: 'scelle' })
  })

  it('ne matche PAS les intitulés ambigus ou hors sujet (faux signal = confiance perdue)', () => {
    expect(occlusionMatch('Réunion de chantier hebdo')).toBeNull()
    expect(occlusionMatch('Nettoyage de la dalle')).toBeNull() // « dalle » seul : exclu du lexique
    expect(occlusionMatch('Reprise écoulement EP')).toBeNull() // « écoulement » ≠ « coulage »
    expect(occlusionMatch('Fermeture du chantier pour congés')).toBeNull()
  })

  it('chaque conséquence du lexique a un wording (pas de fenêtre muette)', () => {
    for (const { consequence } of OCCLUSION_LEXICON) {
      expect(CONSEQUENCE_WORDING[consequence]).toBeTruthy()
    }
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

  it('signale un coulage prévu sous 7 jours, trié par urgence, avec le POURQUOI physique', () => {
    const s = buildProofWindowSignal(
      [cand('Pose doublage R+1', '2026-07-14', 'action', 'a1'), cand('Coulage dalle zone B', '2026-07-11', 'intervention', 'i1')],
      0,
      ASOF,
    )
    expect(s).not.toBeNull()
    expect(s!.kind).toBe('proof_window_closing')
    expect(s!.title).toContain('2 fenêtres de preuve')
    expect(s!.items[0].id).toBe('i1') // le plus proche d'abord
    expect(s!.items[0].meta).toContain('coulage — recouvre')
    expect(s!.items[0].context?.[0]).toContain('ce qui est dessous ne sera plus visible')
    expect(s!.items[0].context?.[0]).toContain('AVANT le 11/07/2026')
    // Le doublage CACHE (vertical), le coulage RECOUVRE (horizontal) : wording différencié.
    expect(s!.items[1].context?.[0]).toContain('ce qui est derrière ne sera plus visible')
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
