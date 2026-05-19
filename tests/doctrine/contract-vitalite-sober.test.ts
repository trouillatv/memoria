// V6.3 tranche 3 — garde-fou doctrinal du bloc « Vitalité du contrat ».
//
// Contraintes UI gravées (Vincent 2026-05-19) : lecture seule, factuelle,
// sobre — PAS de score, PAS de %, PAS de « risque », PAS de
// « sous/surconsommation », PAS de rouge/alerte agressive. L'objectif et le
// nombre documenté sont des faits SÉPARÉS, jamais un ratio.
//
// Tripwire : échoue si un de ces tokens réapparaît dans le bloc Vitalité.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGE = join(
  __dirname,
  '..',
  '..',
  'app',
  '(dashboard)',
  'contracts',
  '[id]',
  'page.tsx',
)

// Le bloc Vitalité : de son data-testid jusqu'à la section continuité.
function vitaliteBlock(): string {
  const src = readFileSync(PAGE, 'utf-8')
  const start = src.indexOf('contract-vitalite')
  expect(start, 'bloc contract-vitalite introuvable').toBeGreaterThan(-1)
  const end = src.indexOf('Continuité du service', start)
  return src.slice(start, end > -1 ? end : start + 4000)
}

describe('Doctrine V6.3/V6.4 — bloc Vitalité contrat sobre', () => {
  const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
    { re: /\bscore\b/i, why: 'aucun score (V6.4)' },
    { re: /%|pourcent|percentage/i, why: 'aucun pourcentage' },
    { re: /\brisque\b/i, why: 'aucun « risque »' },
    { re: /sous-?conso|sur-?conso/i, why: 'aucune sous/surconsommation' },
    { re: /\b(tension|criticit[ée]|productivit[ée]|classement|ranking)\b/i, why: 'aucun jugement (V6.4)' },
    { re: /bg-red-|text-red-|border-red-|\bdestructive\b/i, why: 'aucune alerte rouge agressive' },
  ]

  it('le bloc Vitalité ne contient aucun token interdit', () => {
    const block = vitaliteBlock()
    const hits = FORBIDDEN.filter(({ re }) => re.test(block)).map((f) => f.why)
    expect(hits, `Tokens interdits dans le bloc Vitalité : ${hits.join(' · ')}`).toEqual([])
  })

  it('le bloc rend objectif et documenté comme faits séparés, pas un ratio', () => {
    const block = vitaliteBlock()
    // Un ratio ressemblerait à `documentees / objectif` ou `* 100`.
    expect(/\/\s*vitals\.volumeHoraire|\*\s*100\b/.test(block)).toBe(false)
    expect(block).toContain('Objectif horaire déclaré')
    expect(block).toContain('Prestations documentées')
  })
})
