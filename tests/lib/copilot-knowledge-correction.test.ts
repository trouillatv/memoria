import { describe, it, expect } from 'vitest'
import { extractKnowledgeCorrection } from '@/lib/visits/copilot-knowledge-correction'

// ── P5-F2b — extraction du mode (supersession vs archivage) ──────────────────
// Le routeur (copilot-intent-router.test.ts) couvre déjà la DÉTECTION des 4
// formes. Ici, on couvre la DISTINCTION de mode + le contenu extrait sur le
// texte ORIGINAL (accents, casse) — jamais le texte normalisé du routeur.

describe('extractKnowledgeCorrection — supersession', () => {
  it('"Correction, Jérôme passe lundi." → newTitle = reste de la phrase, ponctuation retirée', () => {
    expect(extractKnowledgeCorrection('Correction, Jérôme passe lundi.')).toEqual({
      mode: 'supersede',
      newTitle: 'Jérôme passe lundi',
    })
  })
  it('"Ce n\'est plus 4812, c\'est 5830." → newTitle = phrase entière, ponctuation retirée', () => {
    expect(extractKnowledgeCorrection("Ce n'est plus 4812, c'est 5830.")).toEqual({
      mode: 'supersede',
      newTitle: "Ce n'est plus 4812, c'est 5830",
    })
  })
})

describe('extractKnowledgeCorrection — archivage', () => {
  it('"Finalement Jérôme ne vient plus demain." → mode archive, aucun titre', () => {
    expect(extractKnowledgeCorrection('Finalement Jérôme ne vient plus demain.')).toEqual({ mode: 'archive' })
  })
  it('"Cette information n\'est plus valable." → mode archive', () => {
    expect(extractKnowledgeCorrection("Cette information n'est plus valable.")).toEqual({ mode: 'archive' })
  })
})

describe('extractKnowledgeCorrection — aucune forme reconnue', () => {
  it('"Jérôme passe lundi." → null (pas de marqueur de correction)', () => {
    expect(extractKnowledgeCorrection('Jérôme passe lundi.')).toBeNull()
  })
  it('"Le code d\'accès est 5830." → null', () => {
    expect(extractKnowledgeCorrection("Le code d'accès est 5830.")).toBeNull()
  })
})
