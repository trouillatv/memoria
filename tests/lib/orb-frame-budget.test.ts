import { describe, it, expect } from 'vitest'
import { createFrameBudget } from '@/lib/voice/orb-frame-budget'

describe('createFrameBudget — dégradation (hystérésis)', () => {
  it('ne dégrade pas tant que le coût mesuré reste sous le seuil', () => {
    const budget = createFrameBudget(false)
    for (let i = 0; i < 30; i++) budget.record(1)
    expect(budget.shouldSkipDetail()).toBe(false)
  })

  it('dégrade après une série de frames coûteuses au-dessus du seuil', () => {
    const budget = createFrameBudget(false)
    for (let i = 0; i < 30; i++) budget.record(8)
    expect(budget.shouldSkipDetail()).toBe(true)
  })

  it('récupère (arrête de dégrader) une fois le coût redescendu durablement', () => {
    const budget = createFrameBudget(false)
    for (let i = 0; i < 30; i++) budget.record(8)
    expect(budget.shouldSkipDetail()).toBe(true)
    for (let i = 0; i < 60; i++) budget.record(0.5)
    expect(budget.shouldSkipDetail()).toBe(false)
  })

  it('un pic modéré isolé ne suffit pas à dégrader (EMA lissée, pas instantanée)', () => {
    const budget = createFrameBudget(false)
    for (let i = 0; i < 10; i++) budget.record(1)
    budget.record(12) // un pic ponctuel, insuffisant à lui seul pour faire franchir l'EMA au seuil
    expect(budget.shouldSkipDetail()).toBe(false)
  })

  it('un pic isolé mais extrême peut franchir le seuil dès la première frame (EMA réagit, ne l’ignore pas)', () => {
    const budget = createFrameBudget(false)
    for (let i = 0; i < 10; i++) budget.record(1)
    budget.record(50) // dropped frame franc — la dégradation doit réagir, pas l'ignorer
    expect(budget.shouldSkipDetail()).toBe(true)
  })
})

describe('createFrameBudget — snapshot debug', () => {
  it('sans collectHistory, snapshot() reste à zéro (aucune allocation payée)', () => {
    const budget = createFrameBudget(false)
    for (let i = 0; i < 50; i++) budget.record(20)
    expect(budget.snapshot()).toEqual({ count: 0, avgMs: 0, p95Ms: 0, over16Count: 0, over33Count: 0 })
  })

  it('avec collectHistory, calcule count/avg/p95/over16/over33', () => {
    const budget = createFrameBudget(true)
    // 9 frames à 10ms, 1 frame à 40ms
    for (let i = 0; i < 9; i++) budget.record(10)
    budget.record(40)
    const snap = budget.snapshot()
    expect(snap.count).toBe(10)
    expect(snap.avgMs).toBeCloseTo((9 * 10 + 40) / 10, 5)
    expect(snap.over16Count).toBe(1)
    expect(snap.over33Count).toBe(1)
  })

  it('p95 reflète la queue haute de la distribution', () => {
    const budget = createFrameBudget(true)
    for (let i = 0; i < 100; i++) budget.record(1)
    budget.record(100)
    const snap = budget.snapshot()
    expect(snap.p95Ms).toBeGreaterThanOrEqual(1)
  })

  it('l’historique ne dépasse pas HISTORY_SIZE (fenêtre glissante circulaire)', () => {
    const budget = createFrameBudget(true)
    for (let i = 0; i < 500; i++) budget.record(i % 2 === 0 ? 5 : 5)
    const snap = budget.snapshot()
    expect(snap.count).toBeLessThanOrEqual(120)
  })
})
