import { describe, expect, it } from 'vitest'
import { quitterEspaceHref, garderContexte } from '@/app/(dashboard)/sites/[id]/views/fiche-segment-href'
import { mergeFicheHref } from '@/lib/knowledge/fiche-href'

// ── Construire l'adresse du maillon suivant ──────────────────────────────────
// Ces fonctions sont pures. Le défaut qu'elles protègent a été trouvé EN RECETTE,
// pas au typecheck : une adresse peut être parfaitement typée et pointer nulle part.
//
// `toSegmentHref` a disparu avec la migration des adresses : les read models
// émettent l'adresse canonique, il n'y a plus de lien hérité à traduire. Ses
// tests sont retirés avec lui — garder un test sur du code mort donne une fausse
// impression de couverture.

const SITE = '/sites/site-1'

describe('quitterEspaceHref — « terminer le parcours » ramène à l’onglet', () => {
  it('quel que soit le maillon ouvert, on revient à la base + la query', () => {
    for (const p of ['/decision/d0', '/action/a0', '/reunion/r0', '/document/x0', '/reserve/r1', '/observation/o1']) {
      expect(quitterEspaceHref(`${SITE}${p}`, 'tab=memoire')).toBe('/sites/site-1?tab=memoire')
    }
  })

  it('sans query, on revient à l’onglet nu', () => {
    expect(quitterEspaceHref(`${SITE}/action/a0`, '')).toBe('/sites/site-1')
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

  it('sans adresse, rien n’est fabriqué', () => {
    expect(garderContexte(null, 'tab=memoire')).toBeNull()
  })
})

describe('mergeFicheHref — le décor suit AUSSI les adresses canoniques', () => {
  // Le point de bascule de la migration : tant que les liens étaient des
  // paramètres, « même page » suffisait à décider. Un segment change de chemin,
  // et la règle naïve aurait rendu le lien inchangé — donc perdu l'onglet.

  it('depuis l’onglet, un segment du même chantier conserve le décor', () => {
    expect(mergeFicheHref(SITE, 'tab=memoire&memtab=pourquoi', `${SITE}/decision/d1`))
      .toBe('/sites/site-1/decision/d1?tab=memoire&memtab=pourquoi')
  })

  it('depuis une fiche DÉJÀ ouverte, le décor suit encore', () => {
    // Le pathname courant contient alors un segment : c'est la BASE qui décide,
    // pas le chemin complet.
    expect(mergeFicheHref(`${SITE}/decision/d0`, 'tab=memoire', `${SITE}/action/a1`))
      .toBe('/sites/site-1/action/a1?tab=memoire')
  })

  it('un autre chantier garde son propre décor', () => {
    expect(mergeFicheHref(SITE, 'tab=memoire', '/sites/AUTRE/action/a1'))
      .toBe('/sites/AUTRE/action/a1')
  })

  it('une cible hors chantier reste inchangée', () => {
    expect(mergeFicheHref(SITE, 'tab=memoire', '/meetings/r1')).toBe('/meetings/r1')
    expect(mergeFicheHref(SITE, 'tab=memoire', '/documents/d1')).toBe('/documents/d1')
  })

  it('les paramètres de provenance survivants sont purgés au passage', () => {
    // `?person=` n'a pas encore d'adresse canonique : il reste, mais il ne doit
    // pas s'accrocher au décor quand on ouvre un autre objet.
    const href = mergeFicheHref(SITE, 'tab=memoire&person=p1&person_source=x', `${SITE}/decision/d1`)
    const q = new URLSearchParams(href!.split('?')[1])
    expect(q.get('tab')).toBe('memoire')
    expect(q.get('person')).toBeNull()
    expect(q.get('person_source')).toBeNull()
  })
})
