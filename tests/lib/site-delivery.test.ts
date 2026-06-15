// Helper pur des bons de livraison (migration 109) — sans DB.
// Doctrine : descriptif, niveau site. Le résumé « Fournisseur · n°ref · zone »
// ignore les parties vides et reste calme (jamais une mesure d'humain).

import { describe, it, expect } from 'vitest'
import { formatDeliverySummary } from '@/lib/db/site-delivery'

describe('formatDeliverySummary — résumé sur une ligne', () => {
  it('assemble fournisseur · n°ref · zone dans l’ordre', () => {
    expect(
      formatDeliverySummary({ supplier: 'Centrale BPE', reference: 'BL-0481', zone: 'Voile R+1' }),
    ).toBe('Centrale BPE · n°BL-0481 · Voile R+1')
  })

  it('préfixe la référence par « n° »', () => {
    expect(formatDeliverySummary({ reference: '0481' })).toBe('n°0481')
  })

  it('ignore les parties vides ou absentes', () => {
    expect(formatDeliverySummary({ supplier: 'Numbo', zone: 'Semelles' })).toBe('Numbo · Semelles')
    expect(formatDeliverySummary({ supplier: 'Numbo' })).toBe('Numbo')
  })

  it('traite null et chaînes blanches comme vides', () => {
    expect(
      formatDeliverySummary({ supplier: null, reference: '   ', zone: undefined }),
    ).toBe('')
  })

  it('trim les parties conservées', () => {
    expect(
      formatDeliverySummary({ supplier: '  Centrale  ', reference: ' 12 ', zone: '  Dalle ' }),
    ).toBe('Centrale · n°12 · Dalle')
  })

  it('renvoie une chaîne vide quand tout est vide', () => {
    expect(formatDeliverySummary({})).toBe('')
  })
})
