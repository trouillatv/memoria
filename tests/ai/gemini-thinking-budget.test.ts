import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// Garde-fou anti-troncature (Vincent, 2026-07-15).
//
// Gemini 2.5 (flash/pro) « réfléchit » avant de répondre, et ces tokens de
// réflexion se DÉDUISENT de maxOutputTokens. S'il n'est pas désactivé, le budget
// est mangé par la réflexion avant l'émission → les sorties en TEXTE LIBRE
// (résumé de visite, narratif du débrief, chat) sont tronquées en plein milieu.
//
// Régression réelle observée : le thinking n'était coupé que pour la sortie JSON
// structurée ; tout le texte libre était donc tronqué en silence. Ce test verrouille
// la coupure du thinking de façon INCONDITIONNELLE.
describe('Gemini — le thinking est désactivé partout (anti-troncature)', () => {
  const src = readFileSync(join(process.cwd(), 'services', 'ai', 'providers', 'gemini.ts'), 'utf8')

  test('thinkingConfig: { thinkingBudget: 0 } est présent', () => {
    expect(src).toMatch(/thinkingConfig:\s*\{\s*thinkingBudget:\s*0\s*\}/)
  })

  test('le thinking n’est PAS enfermé dans la seule branche responseSchema', () => {
    // Après correctif, la branche JSON ne porte plus que responseMimeType.
    const jsonBranch = src.match(/input\.responseSchema\s*\?[\s\S]*?:\s*\{\}/)?.[0] ?? ''
    expect(jsonBranch).not.toMatch(/thinkingBudget/)
  })
})
