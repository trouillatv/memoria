// Blocages de chantier (mig 160) — fonctions PURES (sans Supabase).
// Doctrine : projection descriptive vers la timeline, jamais un score ni une
// imputation ; détection = heuristique qui PRÉ-REMPLIT, l'humain valide.

import { describe, it, expect } from 'vitest'
import { blocagesToMemoryEvents, type SiteBlocage } from '@/lib/db/site-blocages'
import { guessBlocageType } from '@/lib/db/blocage-constants'

function blocage(over: Partial<SiteBlocage> = {}): SiteBlocage {
  return {
    id: 'b1',
    siteId: 's1',
    subjectId: null,
    type: 'intemperie',
    title: 'Pluie forte',
    description: null,
    impact: null,
    dateStart: '2026-07-12',
    dateEnd: null,
    sourceType: 'human',
    sourceReportId: null,
    dayLogId: null,
    ...over,
  }
}

describe('blocagesToMemoryEvents — projection timeline', () => {
  it('un blocage en cours → événement saillant (status ongoing, meta.ongoing)', () => {
    const [ev] = blocagesToMemoryEvents([blocage({ impact: 'terrassement reporté' })])
    expect(ev.type).toBe('blocage')
    expect(ev.id).toBe('blocage-b1')
    expect(ev.status).toBe('ongoing')
    expect(ev.meta?.ongoing).toBe(true)
    expect(ev.title).toBe('Pluie forte')
    // détail = type lisible · impact · "en cours"
    expect(ev.detail).toBe('Intempéries · terrassement reporté · en cours')
  })

  it('un blocage levé sur une période → status resolved + période dans le détail', () => {
    const [ev] = blocagesToMemoryEvents([
      blocage({ dateStart: '2026-07-12', dateEnd: '2026-07-14', impact: null }),
    ])
    expect(ev.status).toBe('resolved')
    expect(ev.meta?.ongoing).toBeUndefined()
    expect(ev.detail).toBe('Intempéries · 2026-07-12 → 2026-07-14')
  })

  it('blocage levé le même jour → pas de période affichée', () => {
    const [ev] = blocagesToMemoryEvents([blocage({ dateEnd: '2026-07-12' })])
    expect(ev.detail).toBe('Intempéries')
  })

  it('lien météo (dayLogId) reporté dans meta, jamais recopié', () => {
    const [ev] = blocagesToMemoryEvents([blocage({ dayLogId: 'log-9' })])
    expect(ev.meta?.dayLogId).toBe('log-9')
  })

  it('occurredAt = date civile à minuit UTC (reste le bon jour à Nouméa)', () => {
    const [ev] = blocagesToMemoryEvents([blocage({ dateStart: '2026-07-12' })])
    expect(ev.occurredAt).toBe('2026-07-12T00:00:00.000Z')
  })
})

describe('guessBlocageType — heuristique de pré-remplissage', () => {
  it('mots météo → intemperie', () => {
    expect(guessBlocageType('Forte pluie, dalle non coulée')).toBe('intemperie')
    expect(guessBlocageType('orage annoncé')).toBe('intemperie')
  })

  it('livraison / appro → livraison', () => {
    expect(guessBlocageType('rupture de stock béton')).toBe('livraison')
    expect(guessBlocageType('livraison reportée')).toBe('livraison')
  })

  it('accès → acces', () => {
    expect(guessBlocageType('portail fermé, pas de clé')).toBe('acces')
  })

  it('administratif → administratif', () => {
    expect(guessBlocageType('attente visa bureau de contrôle')).toBe('administratif')
  })

  it('inconnu → autre (jamais d’invention)', () => {
    expect(guessBlocageType('blabla indéterminé')).toBe('autre')
    expect(guessBlocageType(null)).toBe('autre')
  })
})
