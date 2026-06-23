// Vocabulaire métier de démarrage (mig 150 / seed) — intégrité PURE + correction.
import { describe, it, expect } from 'vitest'
import { DEFAULT_GLOSSARY } from '@/lib/db/glossary-seed'
import { applyGlossaryCorrections, type GlossaryTerm } from '@/lib/db/glossary'

describe('DEFAULT_GLOSSARY — intégrité du référentiel', () => {
  it('aucun terme en double (insensible à la casse)', () => {
    const keys = DEFAULT_GLOSSARY.map((t) => t.term.trim().toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('chaque terme a une définition et une catégorie', () => {
    for (const t of DEFAULT_GLOSSARY) {
      expect(t.term.trim().length).toBeGreaterThan(0)
      expect(t.definition.trim().length).toBeGreaterThan(0)
      expect(t.category.trim().length).toBeGreaterThan(0)
    }
  })

  it('les alias ne répètent pas le terme (sinon correction inutile)', () => {
    for (const t of DEFAULT_GLOSSARY) {
      for (const a of t.aliases) {
        expect(a.trim().toLowerCase()).not.toBe(t.term.trim().toLowerCase())
      }
    }
  })

  it('contient le socle attendu (DOE, PV, OPR, Finisseur, Enrobé)', () => {
    const terms = new Set(DEFAULT_GLOSSARY.map((t) => t.term))
    for (const expected of ['DOE', 'PV', 'OPR', 'Finisseur', 'Enrobé']) {
      expect(terms.has(expected)).toBe(true)
    }
  })
})

describe('correction de transcription via le seed', () => {
  // Adapte le seed au type GlossaryTerm (ajoute id/createdAt fictifs).
  const terms: GlossaryTerm[] = DEFAULT_GLOSSARY.map((t, i) => ({
    id: String(i), term: t.term, definition: t.definition, category: t.category,
    aliases: t.aliases, createdAt: '2026-06-24T00:00:00Z',
  }))

  it('« finisher » et « finiseur » → « Finisseur »', () => {
    expect(applyGlossaryCorrections('le finisher est en panne', terms)).toBe('le Finisseur est en panne')
    expect(applyGlossaryCorrections('panne finiseur', terms)).toBe('panne Finisseur')
  })

  it('« procès verbal » → « PV »', () => {
    expect(applyGlossaryCorrections('rédiger le procès verbal', terms)).toBe('rédiger le PV')
  })

  it('ne touche pas un mot hors glossaire', () => {
    expect(applyGlossaryCorrections('réunion de chantier', terms)).toBe('réunion de chantier')
  })
})
