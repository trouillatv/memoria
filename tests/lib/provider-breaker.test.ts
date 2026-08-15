import { describe, it, expect } from 'vitest'
import {
  closedBreaker,
  shouldAttempt,
  breakerPhase,
  recordUnavailable,
  recordAvailable,
} from '@/lib/ai/provider-breaker'

const COOLDOWN = 15 * 60_000

describe('provider-breaker — disjoncteur de fournisseur', () => {
  it('laisse passer tant qu’aucun refus n’a été enregistré', () => {
    const s = closedBreaker()
    expect(shouldAttempt(s, 1_000)).toBe(true)
    expect(breakerPhase(s, 1_000)).toBe('closed')
  })

  it('bloque les tentatives suivantes après un refus d’indisponibilité', () => {
    const s = recordUnavailable(closedBreaker(), 1_000, COOLDOWN)
    expect(shouldAttempt(s, 1_001)).toBe(false)
    expect(shouldAttempt(s, 1_000 + COOLDOWN - 1)).toBe(false)
    expect(breakerPhase(s, 1_001)).toBe('open')
  })

  it('réautorise une sonde une fois la fenêtre de réessai atteinte', () => {
    const s = recordUnavailable(closedBreaker(), 1_000, COOLDOWN)
    expect(shouldAttempt(s, 1_000 + COOLDOWN)).toBe(true)
    expect(breakerPhase(s, 1_000 + COOLDOWN)).toBe('probe')
  })

  it('une sonde en échec relance une fenêtre complète', () => {
    const first = recordUnavailable(closedBreaker(), 1_000, COOLDOWN)
    const probeAt = 1_000 + COOLDOWN
    const second = recordUnavailable(first, probeAt, COOLDOWN)
    expect(shouldAttempt(second, probeAt + 1)).toBe(false)
    expect(shouldAttempt(second, probeAt + COOLDOWN)).toBe(true)
  })

  it('conserve l’instant du PREMIER refus à travers les sondes', () => {
    const first = recordUnavailable(closedBreaker(), 1_000, COOLDOWN)
    const second = recordUnavailable(first, 1_000 + COOLDOWN, COOLDOWN)
    expect(second.openedAt).toBe(1_000)
  })

  it('un succès referme le disjoncteur sans mémoire de la panne', () => {
    const broken = recordUnavailable(closedBreaker(), 1_000, COOLDOWN)
    const healed = recordAvailable()
    expect(healed.openedAt).toBeNull()
    expect(shouldAttempt(healed, 1_001)).toBe(true)
    // Le quota restauré redevient utilisable sans redéploiement — c'est
    // l'exigence explicite du mandat, pas un détail d'implémentation.
    expect(broken.openedAt).not.toBeNull()
  })
})
