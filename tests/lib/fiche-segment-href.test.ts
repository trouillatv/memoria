import { describe, expect, it } from 'vitest'
import { toSegmentHref, quitterEspaceHref, garderContexte } from '@/app/(dashboard)/sites/[id]/views/fiche-segment-href'

// ── Construire l'adresse du maillon suivant ──────────────────────────────────
// Ces fonctions sont pures. Le défaut qu'elles protègent a été trouvé EN RECETTE,
// pas au typecheck : une adresse peut être parfaitement typée et pointer nulle part.

const SITE = '/sites/site-1'

describe('toSegmentHref — on repart TOUJOURS de la base du chantier', () => {
  it('depuis l’onglet, construit l’adresse du maillon', () => {
    expect(toSegmentHref('/sites/site-1?decision=d1', 'decision', SITE, 'tab=memoire'))
      .toBe('/sites/site-1/decision/d1?tab=memoire')
  })

  it('depuis une fiche DÉJÀ ouverte, ne concatène pas deux segments', () => {
    // Le défaut réel (2026-07-20) : `/sites/site-1/decision/d0/decision/d1`.
    // Il n'apparaissait que depuis un panneau ouvert — le fil causal reste visible
    // derrière lui — donc jamais lors des recettes à un seul maillon.
    expect(toSegmentHref('/sites/site-1?decision=d1', 'decision', `${SITE}/decision/d0`, 'tab=memoire'))
      .toBe('/sites/site-1/decision/d1?tab=memoire')
  })

  it('depuis une fiche d’un AUTRE type, même règle', () => {
    expect(toSegmentHref('/sites/site-1?action=a1', 'action', `${SITE}/reunion/r0`, 'tab=memoire'))
      .toBe('/sites/site-1/action/a1?tab=memoire')
  })

  it('sans identifiant dans le lien hérité, aucune adresse inventée', () => {
    expect(toSegmentHref('/sites/site-1?tab=memoire', 'decision', SITE, '')).toBeNull()
    expect(toSegmentHref(null, 'decision', SITE, '')).toBeNull()
  })
})

describe('quitterEspaceHref — « terminer le parcours » ramène à l’onglet', () => {
  it('quel que soit le maillon ouvert, on revient à la base + la query', () => {
    for (const p of ['/decision/d0', '/action/a0', '/reunion/r0']) {
      expect(quitterEspaceHref(`${SITE}${p}`, 'tab=memoire')).toBe('/sites/site-1?tab=memoire')
    }
  })
})

describe('garderContexte — suivre une relation ne change pas le décor', () => {
  it('emporte la query courante', () => {
    expect(garderContexte('/sites/site-1/reunion/r1', 'tab=memoire'))
      .toBe('/sites/site-1/reunion/r1?tab=memoire')
  })

  it('ne double jamais une query déjà présente', () => {
    expect(garderContexte('/sites/site-1/reunion/r1?tab=travail', 'tab=memoire'))
      .toBe('/sites/site-1/reunion/r1?tab=travail')
  })
})
