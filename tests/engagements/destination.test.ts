import { describe, it, expect } from 'vitest'
import { suggestDestination } from '@/lib/engagements/destination'

describe('suggestDestination — proposition typée (Atelier IA v2)', () => {
  it('défaut = obligation de contrat', () => {
    const r = suggestDestination({
      category: 'frequency',
      sourceExcerpt: 'Désinfection biquotidienne des sanitaires avec produits écolabel',
    })
    expect(r.destination).toBe('contract_engagement')
  })

  it('pénalité → vigilance', () => {
    const r = suggestDestination({
      category: 'compliance',
      sourceExcerpt: 'Une pénalité de 500€ est appliquée par manquement constaté',
    })
    expect(r.destination).toBe('vigilance')
  })

  it('résiliation → vigilance', () => {
    const r = suggestDestination({
      category: 'compliance',
      sourceExcerpt: 'Résiliation de plein droit en cas de défaillance répétée',
    })
    expect(r.destination).toBe('vigilance')
  })

  it('zone sensible → vigilance', () => {
    const r = suggestDestination({
      category: 'other',
      sourceExcerpt: 'Accès en zone sensible soumis à habilitation préalable',
    })
    expect(r.destination).toBe('vigilance')
  })

  it('savoir du lieu (accès / livraison) → a_savoir', () => {
    expect(suggestDestination({ category: 'other', sourceExcerpt: "Accès par le quai de livraison, badge obligatoire" }).destination).toBe('a_savoir')
    expect(suggestDestination({ category: 'other', sourceExcerpt: "Local ménage situé au sous-sol niveau -1" }).destination).toBe('a_savoir')
  })

  it('vigilance prime sur a_savoir (pénalité d’accès)', () => {
    expect(suggestDestination({ category: 'compliance', sourceExcerpt: "Pénalité en cas d'accès non autorisé en zone sensible" }).destination).toBe('vigilance')
  })

  it('ne sur-flagge pas une obligation banale', () => {
    const r = suggestDestination({
      category: 'reporting',
      sourceExcerpt: 'Reporting mensuel avec photos avant/après et indicateurs qualité',
    })
    expect(r.destination).toBe('contract_engagement')
  })

  it('déterministe', () => {
    const a = suggestDestination({ category: 'sla', sourceExcerpt: 'Pénalité de retard' })
    const b = suggestDestination({ category: 'sla', sourceExcerpt: 'Pénalité de retard' })
    expect(a).toEqual(b)
  })
})
