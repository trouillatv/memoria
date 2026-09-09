// Phase 6E.4D — récapitulatif après clarification (buildMemoriaNeedsYouRecap).
//
// Mandat Vincent (couverture minimale) : agrégation multi-actions ; compteur singulier/pluriel
// correct par catégorie ; libellé réel conservé (dédupliqué, borné) ; aucune action → aucun faux
// recap ; le texte décrit l'acte effectué, jamais une vérité métier non prouvée (interdits :
// "résolu", "réserve levée", "Point supprimé", "MemorIA a corrigé…") ; pure function → même entrée
// donne toujours la même sortie (pas de duplication au rerender).

import { describe, it, expect } from 'vitest'
import { buildMemoriaNeedsYouRecap, type MemoriaNeedsYouRecapEntry } from '@/lib/knowledge/tracked-point-needs-you-recap'
import { MEMORIA_NEEDS_YOU_CATEGORY_ORDER } from '@/lib/knowledge/tracked-point-needs-you-categories'

// résolu(?!tion) : "résolue"/"résolu"/"résolus" interdits (affirmation d'état), mais pas la
// catégorie légitime "résolution" (l'ACTE de rattacher une résolution, jamais l'état "résolu").
const FORBIDDEN_WORDS = [/résolu(?!tion)/i, /réserve.*lev/i, /point supprimé/i, /a corrigé/i, /supprim/i, /clôtur/i]

describe('buildMemoriaNeedsYouRecap — aucune action', () => {
  it('file vide : totalCount=0, aucune ligne, aucun libellé', () => {
    const recap = buildMemoriaNeedsYouRecap([])
    expect(recap.totalCount).toBe(0)
    expect(recap.lines).toEqual([])
    expect(recap.labels).toEqual([])
  })
})

describe('buildMemoriaNeedsYouRecap — agrégation multi-actions', () => {
  it('plusieurs actions de catégories différentes dans une même session → une ligne par catégorie, ordre stable', () => {
    const entries: MemoriaNeedsYouRecapEntry[] = [
      { category: 'duplicate_points', label: 'Fissure façade nord' },
      { category: 'attach_information', label: 'Infiltration toiture bloc B' },
      { category: 'clarify_evidence', label: null },
    ]
    const recap = buildMemoriaNeedsYouRecap(entries)
    expect(recap.totalCount).toBe(3)
    expect(recap.lines.map((l) => l.category)).toEqual(
      MEMORIA_NEEDS_YOU_CATEGORY_ORDER.filter((c) => ['duplicate_points', 'attach_information', 'clarify_evidence'].includes(c)),
    )
    expect(recap.lines.every((l) => l.count === 1)).toBe(true)
  })

  it('deux actions du même type → compteur correct et libellé pluriel', () => {
    const entries: MemoriaNeedsYouRecapEntry[] = [
      { category: 'duplicate_points', label: 'Fissure façade nord' },
      { category: 'duplicate_points', label: 'VGP nacelle élévatrice' },
    ]
    const recap = buildMemoriaNeedsYouRecap(entries)
    expect(recap.totalCount).toBe(2)
    expect(recap.lines).toHaveLength(1)
    expect(recap.lines[0].count).toBe(2)
    expect(recap.lines[0].text).toBe('2 suivis réunis')
  })

  it('une seule action → libellé singulier', () => {
    const recap = buildMemoriaNeedsYouRecap([{ category: 'assign_resolution', label: 'VGP nacelle élévatrice' }])
    expect(recap.lines[0].text).toBe('1 résolution rattachée à un suivi existant')
  })

  it('libellé réel conservé et dédupliqué, borné (MAX_LABELS=5)', () => {
    const entries: MemoriaNeedsYouRecapEntry[] = [
      { category: 'attach_information', label: 'A' },
      { category: 'attach_information', label: 'A' },
      { category: 'attach_information', label: 'B' },
      { category: 'attach_information', label: 'C' },
      { category: 'attach_information', label: 'D' },
      { category: 'attach_information', label: 'E' },
      { category: 'attach_information', label: 'F' },
    ]
    const recap = buildMemoriaNeedsYouRecap(entries)
    expect(recap.totalCount).toBe(7)
    expect(recap.labels).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('un libellé null (aucun libellé réel connu) ne fabrique jamais de texte : compté, exclu de labels', () => {
    const recap = buildMemoriaNeedsYouRecap([{ category: 'confirm_trackability', label: null }])
    expect(recap.totalCount).toBe(1)
    expect(recap.lines[0].count).toBe(1)
    expect(recap.labels).toEqual([])
  })
})

describe('buildMemoriaNeedsYouRecap — le recap décrit l\'acte, jamais une vérité métier non prouvée', () => {
  it('aucune ligne, pour aucune catégorie, ne contient un mot interdit', () => {
    for (const category of MEMORIA_NEEDS_YOU_CATEGORY_ORDER) {
      const recap = buildMemoriaNeedsYouRecap([{ category, label: 'Suivi X' }, { category, label: 'Suivi Y' }])
      const text = recap.lines.map((l) => l.text).join(' ')
      for (const re of FORBIDDEN_WORDS) expect(text).not.toMatch(re)
    }
  })
})

describe('buildMemoriaNeedsYouRecap — pas de duplication au rerender (pure function)', () => {
  it('un même jeu d\'entrées produit toujours le même résultat, quel que soit le nombre d\'appels', () => {
    const entries: MemoriaNeedsYouRecapEntry[] = [
      { category: 'duplicate_points', label: 'Fissure façade nord' },
      { category: 'clarify_evidence', label: null },
    ]
    const first = buildMemoriaNeedsYouRecap(entries)
    const second = buildMemoriaNeedsYouRecap(entries)
    expect(second).toEqual(first)
  })
})
