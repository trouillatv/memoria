// Vincent 2026-05-21 — fix « 0 F partout » dans monitoring IA.
// Les coûts AI sont si petits (~0.025 F par appel Gemini Flash) qu'ils
// disparaissaient avec Math.round. On garde la précision et on l'affiche.

import { describe, it, expect } from 'vitest'
import { fmtXpf, usdToXpf } from '@/lib/currency/xpf'

describe('usdToXpf — pas d\'arrondi', () => {
  it('0 ou null → 0', () => {
    expect(usdToXpf(0)).toBe(0)
    expect(usdToXpf(null)).toBe(0)
    expect(usdToXpf(undefined)).toBe(0)
  })
  it('préserve la précision (avant : Math.round écrasait à 0)', () => {
    // 0.0002 USD × 110 = 0.022 XPF — avant Math.round = 0, maintenant = 0.022
    expect(usdToXpf(0.0002)).toBeCloseTo(0.022, 4)
    expect(usdToXpf(0.01)).toBeCloseTo(1.1, 4)
    expect(usdToXpf(1)).toBeCloseTo(110, 4)
  })
})

describe('fmtXpf — 4 magnitudes', () => {
  it('0 → « 0 F »', () => {
    expect(fmtXpf(0)).toBe('0 F')
  })
  it('< 0.001 → « < 0.001 F »', () => {
    expect(fmtXpf(0.0005)).toBe('< 0.001 F')
  })
  it('entre 0.001 et 1 → 3 décimales', () => {
    expect(fmtXpf(0.025)).toBe('0.025 F')
    expect(fmtXpf(0.5)).toBe('0.500 F')
  })
  it('entre 1 et 10 → 2 décimales', () => {
    expect(fmtXpf(1.23)).toBe('1.23 F')
    expect(fmtXpf(9.99)).toBe('9.99 F')
  })
  it('≥ 10 → entier formaté', () => {
    expect(fmtXpf(10)).toBe('10 F')
    expect(fmtXpf(234)).toBe('234 F')
    expect(fmtXpf(1245)).toMatch(/^1[  ]245 F$/)
  })
  it('flux réel : coût Gemini Flash sur 1 appel ne devient plus 0 F', () => {
    // Gemini 2.5 Flash : $0.075/M input, $0.30/M output
    // Appel typique : 1000 input + 500 output
    // = 1000 × 0.000000075 + 500 × 0.0000003 = $0.000225
    // × 110 = 0.02475 XPF
    const xpf = usdToXpf(0.000225)
    expect(fmtXpf(xpf)).toBe('0.025 F')
    // Avant le fix : retournait '0 F' (Math.round → 0)
    expect(fmtXpf(xpf)).not.toBe('0 F')
  })
})
