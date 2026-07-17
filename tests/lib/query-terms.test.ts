import { describe, expect, it } from 'vitest'
import {
  isCategoryOnlyQuestion,
  normalizeQuery,
  queryCategories,
  queryTerms,
} from '@/lib/knowledge/query-terms'

// ── LIRE UNE QUESTION ────────────────────────────────────────────────────────
// Le cas de référence est celui observé à l'écran sur le Lycée Petro Attiti :
// « Quelles ont été les observations ? » ne rendait RIEN alors que le chantier
// portait 4 photos et 2 mémos. Le moteur cherchait la phrase entière comme
// sous-chaîne.

describe('normalizeQuery', () => {
  it('efface accents et ponctuation — « Échéance » et « echeance » sont un seul mot', () => {
    expect(normalizeQuery('Quelles échéances ?')).toBe('quelles echeances')
    expect(normalizeQuery("Où en est le coffret électrique ?")).toBe('ou en est le coffret electrique')
  })
})

describe('queryTerms', () => {
  it('retire la grammaire et garde ce qui se cherche', () => {
    expect(queryTerms('Où en est le coffret électrique ?')).toEqual(['coffret', 'electrique'])
  })

  it('retire les mots INTERROGATIFS — c’est eux qui faisaient échouer la recherche', () => {
    // « quelles », « ont », « ete » ne sont dans aucune capture : les garder
    // condamnait la question à ne rien trouver.
    expect(queryTerms('Quelles ont été les observations ?')).toEqual(['observations'])
  })

  it('ne rend jamais de doublon ni de fragment', () => {
    expect(queryTerms("Le portail, le portail d'accès ?")).toEqual(['portail', 'acces'])
  })

  it('rend une liste vide pour une question sans contenu', () => {
    expect(queryTerms('Que faut-il savoir ?')).toEqual([])
  })
})

describe('queryCategories', () => {
  it.each([
    ['Quels risques sont encore ouverts ?', 'watchpoint'],
    ['Quelles décisions concernent ce chantier ?', 'decision'],
    ['Quelles ont été les observations ?', 'observation'],
    ['Qui connaît ce chantier ?', 'stakeholder'],
    ['Dernières photos', 'photo'],
  ])('« %s » nomme le rayon %s', (question, expected) => {
    // Ce sont les EXEMPLES proposés par l'écran. Ils promettaient un contrat que
    // le moteur ne tenait pas : le mot « risque » n'apparaît dans aucune
    // vigilance — il les désigne.
    expect(queryCategories(question)).toContain(expected)
  })

  it('ne devine PAS un rayon quand la question n’en nomme aucun', () => {
    expect(queryCategories('Où en est le coffret électrique ?')).toEqual([])
  })
})

describe('isCategoryOnlyQuestion', () => {
  it('une demande de rayon PURE doit rendre le rayon entier', () => {
    expect(isCategoryOnlyQuestion('Quelles ont été les observations ?')).toBe(true)
    expect(isCategoryOnlyQuestion('Quels risques sont encore ouverts ?')).toBe(true)
  })

  it('un rayon + un terme se FILTRE, il ne se déverse pas', () => {
    // Sans cette distinction, toute question contenant « action » renverrait le
    // chantier entier.
    expect(isCategoryOnlyQuestion('Quelles observations sur le carrelage ?')).toBe(false)
  })

  it('une question sans rayon n’est jamais une demande de rayon', () => {
    expect(isCategoryOnlyQuestion('Où en est le coffret électrique ?')).toBe(false)
  })
})
