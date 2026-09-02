import { describe, it, expect } from 'vitest'
import {
  verdictNormalizedToPvState,
  deriveOccurrenceFromPvStates,
  deriveCurrentResolvedState,
  type PvState,
} from '@/lib/documents/subject-state'
import { normalizeDocumentVerdict } from '@/lib/documents/verdict-normalization'

// Lot E2 — projection du verdict normalisé (E1) vers le tri-state longitudinal.
// On teste : (a) la table de projection ; (b) la chaîne bout-en-bout
// raw → normalize (E1) → project (E2) ; (c) le carry-forward inchangé sur unknown ;
// (d) l'absence de faux resolved. Le moteur longitudinal existant n'est PAS réécrit.

const grid = { family: 'knowledge_fact', thematicCategory: 'test_control' } // contexte de conformité
const kf = { family: 'knowledge_fact', thematicCategory: 'progress' }

/** chaîne complète E1+E2 pour un verdict brut. */
function project(raw: string, ctx: { family: string; thematicCategory?: string; field?: string }): PvState {
  return verdictNormalizedToPvState(normalizeDocumentVerdict(raw, ctx).normalized)
}

describe('E2 — table de projection verdict normalisé → state_status', () => {
  const cases: Array<[string, PvState]> = [
    ['lifecycle_done', 'resolved'],
    ['lifecycle_open', 'open'],
    ['lifecycle_in_progress', 'open'],
    ['lifecycle_planned', 'open'],
    ['compliant_negative', 'open'],
    ['unverified', 'unknown'],
    ['not_applicable', 'unknown'],
    ['pending_control', 'unknown'],
    ['compliant_positive', 'unknown'], // STRICT : conforme ≠ résolu
    [null as unknown as string, 'unknown'],
    ['vocabulaire_inconnu', 'unknown'],
  ]
  for (const [normalized, expected] of cases) {
    it(`${normalized} → ${expected}`, () => {
      expect(verdictNormalizedToPvState(normalized)).toBe(expected)
    })
  }
})

describe('E2 — chaîne bout-en-bout raw → normalize → project (tests obligatoires)', () => {
  it('non vérifié → unknown', () => { expect(project('non vérifié', grid)).toBe('unknown') })
  it('NA → unknown', () => { expect(project('non applicable', kf)).toBe('unknown') })
  it('NC → open (avec contexte de conformité)', () => { expect(project('NC', grid)).toBe('open') })
  it('non conforme → open', () => { expect(project('non conforme', kf)).toBe('open') })
  it('réalisé → resolved', () => { expect(project('réalisé', kf)).toBe('resolved') })
  it('en cours → open', () => { expect(project('en cours', kf)).toBe('open') })
  it('inconnu → unknown', () => { expect(project('inconnu', kf)).toBe('unknown') })
  it('conforme → unknown (STRICT : pas de faux resolved)', () => { expect(project('conforme', grid)).toBe('unknown') })
  it('NC sans contexte probant → unknown (pas de faux open)', () => { expect(project('NC', kf)).toBe('unknown') })
})

describe('E2 — agrégation conflit-aware de l\'occurrence', () => {
  it('resolved seul → resolved', () => { expect(deriveOccurrenceFromPvStates(['resolved']).status).toBe('resolved') })
  it('open seul → open', () => { expect(deriveOccurrenceFromPvStates(['open']).status).toBe('open') })
  it('resolved ET open → unknown (conflit, jamais masqué)', () => {
    const r = deriveOccurrenceFromPvStates(['resolved', 'open'])
    expect(r.status).toBe('unknown'); expect(r.reason).toBe('conflict')
  })
  it('tout unknown → unknown (missing)', () => {
    const r = deriveOccurrenceFromPvStates(['unknown', 'unknown'])
    expect(r.status).toBe('unknown'); expect(r.reason).toBe('missing')
  })
})

describe('E2 — carry-forward : un gap unknown ne change pas la vérité prouvée', () => {
  it('open puis unknown → dernier état prouvé reste open (pas de faux resolved)', () => {
    // séquence : NC (open) → non vérifié (unknown)
    const seq: PvState[] = [project('non conforme', kf), project('non vérifié', grid)]
    expect(seq).toEqual(['open', 'unknown'])
    expect(deriveCurrentResolvedState(seq)).toBe(false) // false = open porté
  })
  it('resolved puis unknown (NA) → reste resolved', () => {
    const seq: PvState[] = [project('réalisé', kf), project('non applicable', kf)]
    expect(seq).toEqual(['resolved', 'unknown'])
    expect(deriveCurrentResolvedState(seq)).toBe(true)
  })
  it('« conforme » n\'introduit PAS de resolved (conforme puis NC ≠ faux reopen)', () => {
    const seq: PvState[] = [project('conforme', grid), project('non conforme', kf)]
    expect(seq).toEqual(['unknown', 'open']) // conforme = unknown, pas resolved
    expect(deriveCurrentResolvedState(seq)).toBe(false) // open, jamais un resolved→open fabriqué
  })
})
