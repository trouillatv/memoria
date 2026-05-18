// Logique de clôture preuve d'accès (migration 070) — fonction pure.
// Doctrine : sobre, jamais bloquante ; requires_return=false n'exige rien.

import { describe, it, expect } from 'vitest'
import { computePickupNeedsReturn } from '@/lib/db/intervention-access-events'

type E = Parameters<typeof computePickupNeedsReturn>[0][number]
const ev = (type: E['type'], requires_return = true): E => ({ type, requires_return })

describe('computePickupNeedsReturn — demande de restitution à la clôture', () => {
  it('aucun événement → pas de demande', () => {
    expect(computePickupNeedsReturn([])).toBe(false)
  })

  it('prise avec restitution attendue, rien d’autre → demande', () => {
    expect(computePickupNeedsReturn([ev('pickup')])).toBe(true)
  })

  it('prise + restitution documentée → pas de demande', () => {
    expect(computePickupNeedsReturn([ev('pickup'), ev('return')])).toBe(false)
  })

  it('prise + incident → pas de demande (incident = résolution documentée)', () => {
    expect(computePickupNeedsReturn([ev('pickup'), ev('incident')])).toBe(false)
  })

  it('prise sans restitution attendue (badge jetable) → jamais de demande', () => {
    expect(computePickupNeedsReturn([ev('pickup', false)])).toBe(false)
  })

  it('mix : une prise sans retour attendu + une prise avec retour attendu → demande', () => {
    expect(
      computePickupNeedsReturn([ev('pickup', false), ev('pickup', true)]),
    ).toBe(true)
  })

  it('restitution seule sans prise → pas de demande', () => {
    expect(computePickupNeedsReturn([ev('return')])).toBe(false)
  })
})
