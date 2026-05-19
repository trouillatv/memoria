// V6.3 tranche 2 — agrégation contrat déterministe.
//
// Tests PURS (zéro base Cloud → zéro flake) de la logique d'échéance + garde-
// fou doctrinal V6.4 : un label de contrat ne contient JAMAIS de vocabulaire
// de jugement/score (« risque », « tension », « score », « % », classement).
//
// Réf : exploitation-doctrine-V6.md Piliers V6.3 (factuel, jamais narré) +
// V6.4 (résonance, jamais score).

import { describe, it, expect } from 'vitest'
import { computeContractExpiry } from '@/lib/db/contracts'

const TODAY = '2026-05-19'

describe('computeContractExpiry — verdict pur d’échéance', () => {
  it('pas de date de fin → kind none', () => {
    const r = computeContractExpiry(null, TODAY)
    expect(r.kind).toBe('none')
    expect(r.label).toMatch(/pas de date de fin/i)
  })

  it('date passée → expired avec nombre de jours écoulés', () => {
    const r = computeContractExpiry('2026-05-10', TODAY)
    expect(r.kind).toBe('expired')
    if (r.kind === 'expired') {
      expect(r.days).toBe(9)
      expect(r.label).toMatch(/échu/i)
    }
  })

  it('échéance le jour même → soon, 0 jour', () => {
    const r = computeContractExpiry(TODAY, TODAY)
    expect(r.kind).toBe('soon')
    if (r.kind === 'soon') expect(r.days).toBe(0)
  })

  it('bornes : 30 j → soon, 31 j → watch', () => {
    expect(computeContractExpiry('2026-06-18', TODAY).kind).toBe('soon') // +30
    expect(computeContractExpiry('2026-06-19', TODAY).kind).toBe('watch') // +31
  })

  it('bornes : 90 j → watch, 91 j → far', () => {
    expect(computeContractExpiry('2026-08-17', TODAY).kind).toBe('watch') // +90
    expect(computeContractExpiry('2026-08-18', TODAY).kind).toBe('far') // +91
  })

  it('pur : mêmes entrées → même sortie', () => {
    const a = computeContractExpiry('2026-07-01', TODAY)
    const b = computeContractExpiry('2026-07-01', TODAY)
    expect(a).toEqual(b)
  })
})

describe('Doctrine V6.4 — aucun label de jugement/score', () => {
  const FORBIDDEN = /(risque|score|tension|criticit|productivit|classement|ranking|\bnote\b|%)/i

  it('aucun label d’échéance ne contient de vocabulaire interdit', () => {
    const dates = [
      null,
      '2026-05-01',
      '2026-05-19',
      '2026-06-18',
      '2026-07-30',
      '2026-12-31',
      '2027-06-01',
    ]
    for (const d of dates) {
      const r = computeContractExpiry(d, TODAY)
      expect(FORBIDDEN.test(r.label), `label interdit : "${r.label}"`).toBe(false)
    }
  })
})
