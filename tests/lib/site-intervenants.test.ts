// Doctrine ACTOR-ROLE-TRUTH — résolution du rôle d'un participant réintégré à une
// réunion. Aucun arbitrage entre rôles actifs distincts simultanés.

import { describe, expect, it } from 'vitest'
import { resolveParticipantRole } from '@/lib/db/site-intervenants'

describe('resolveParticipantRole', () => {
  it('0 rôle actif → fonction du contact', () => {
    expect(resolveParticipantRole('Conducteur de travaux', [])).toBe('Conducteur de travaux')
  })

  it('rôles actifs identiques (2 lignes, même rôle) → ce rôle', () => {
    expect(resolveParticipantRole('Conducteur de travaux', ['AMO', 'AMO'])).toBe('AMO')
  })

  it('rôles actifs distincts simultanés → jamais d\'arbitrage, fonction du contact', () => {
    expect(resolveParticipantRole('Conducteur de travaux', ['AMO', 'partenaire'])).toBe('Conducteur de travaux')
  })
})
