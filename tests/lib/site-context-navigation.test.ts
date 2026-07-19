// Non-régression du lot « Réactivité perçue » · étape 1, et du correctif de
// contexte qui l'a précédé. Deux garanties :
//   1. L'ONGLET ACTIF est résolu de façon tolérante (c'est lui qui décide quel
//      onglet charge ses données — plus de chargement global).
//   2. La QUERY EST CONSERVÉE quand on ouvre une fiche : ouvrir un objet ne
//      déplace jamais le décor derrière lui (onglet, sous-onglet, filtres).

import { describe, it, expect } from 'vitest'
import { resolveSiteTab } from '@/app/(dashboard)/sites/[id]/SiteTabsNav'
import { mergeFicheHref } from '@/lib/knowledge/fiche-href'

describe('resolveSiteTab — l’onglet actif', () => {
  it('conserve un onglet connu', () => {
    expect(resolveSiteTab('memoire')).toBe('memoire')
    expect(resolveSiteTab('intervenants')).toBe('intervenants')
    expect(resolveSiteTab('planning')).toBe('planning')
  })

  it('retombe sur l’Aperçu si absent ou inconnu (jamais d’écran vide)', () => {
    expect(resolveSiteTab(undefined)).toBe('apercu')
    expect(resolveSiteTab(null)).toBe('apercu')
    expect(resolveSiteTab('')).toBe('apercu')
    expect(resolveSiteTab('nawak')).toBe('apercu')
  })
})

describe('mergeFicheHref — ouvrir une fiche ne change pas le décor', () => {
  const PATH = '/sites/s1'

  it('conserve l’onglet ET le sous-onglet courants', () => {
    const href = mergeFicheHref(PATH, 'tab=memoire&memtab=pourquoi', `${PATH}?action=a1&action_source=memoire`)
    const q = new URLSearchParams(href!.split('?')[1])
    expect(q.get('tab')).toBe('memoire')
    expect(q.get('memtab')).toBe('pourquoi')
    expect(q.get('action')).toBe('a1')
    expect(q.get('action_source')).toBe('memoire')
  })

  it('conserve un filtre quelconque déjà présent', () => {
    const href = mergeFicheHref(PATH, 'tab=intervenants&q=roué', `${PATH}?person=p1`)
    const q = new URLSearchParams(href!.split('?')[1])
    expect(q.get('tab')).toBe('intervenants')
    expect(q.get('q')).toBe('roué')
    expect(q.get('person')).toBe('p1')
  })

  it('un seul maillon actif : ouvrir une Décision purge les paramètres d’Action', () => {
    const href = mergeFicheHref(PATH, 'tab=memoire&action=a1&action_source=memoire', `${PATH}?decision=d1&decision_source=action`)
    const q = new URLSearchParams(href!.split('?')[1])
    expect(q.get('decision')).toBe('d1')
    expect(q.get('action')).toBeNull()
    expect(q.get('action_source')).toBeNull()
    expect(q.get('tab')).toBe('memoire')   // le décor, lui, ne bouge pas
  })

  it('une cible sur une AUTRE page reste inchangée (limite assumée du Lot 3)', () => {
    expect(mergeFicheHref(PATH, 'tab=memoire', '/meetings/r1')).toBe('/meetings/r1')
    expect(mergeFicheHref(PATH, 'tab=memoire', '/sites/AUTRE?action=a1')).toBe('/sites/AUTRE?action=a1')
  })

  it('href absent → null (pas de lien fabriqué)', () => {
    expect(mergeFicheHref(PATH, 'tab=memoire', null)).toBeNull()
    expect(mergeFicheHref(PATH, 'tab=memoire', undefined)).toBeNull()
  })
})
