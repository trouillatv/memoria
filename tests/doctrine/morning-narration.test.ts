// Doctrine du MATIN (Vincent 2026-07-09) : la narration est FACTUELLE, jamais
// cognitive. « Cette nuit, MemorIA a relu tes 12 chantiers » est acceptable
// parce que chaque mot est un fait vérifiable (nombre, heure, focus). Le jour
// où le Matin dit « MemorIA pense / estime / a compris », la crédibilité — et
// la loi 3 (le système exhibe ses fondements, il ne déclare pas) — est morte.
// Tripwire structurel pur : lecture du composant, zéro DB.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

// Lignes de CODE uniquement (les commentaires peuvent citer les interdits).
function codeLines(path: string): string[] {
  return readFileSync(join(ROOT, path), 'utf-8')
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
}

// Verbes de cognition interdits dans la voix de MemorIA. La narration DÉCRIT
// des faits (a relu, a trouvé N, écrit à HHhMM) ; elle n'attribue jamais au
// système une compréhension, une opinion ou une probabilité.
const FORBIDDEN_NARRATION = /MemorIA (pense|estime|croit|suppose|suggère|a compris|comprend|devine|prédit)|probablement/i

describe('Doctrine Matin — narration factuelle, jamais cognitive', () => {
  it('MorningHero ne fait jamais « penser » MemorIA', () => {
    for (const line of codeLines('app/(dashboard)/dashboard/MorningHero.tsx')) {
      expect(FORBIDDEN_NARRATION.test(line), line.trim()).toBe(false)
    }
  })

  it('la provenance reste présente (heure de relecture + zéro IA)', () => {
    const src = readFileSync(join(ROOT, 'app/(dashboard)/dashboard/MorningHero.tsx'), 'utf-8')
    expect(/Relu cette nuit/.test(src)).toBe(true)
    expect(/zéro IA/.test(src)).toBe(true)
  })

  it('le pipeline de la Nuit reste sans LLM (aucun import services/ai)', () => {
    for (const p of ['app/api/cron/night-digest/route.ts', 'lib/db/morning-digest.ts']) {
      const src = readFileSync(join(ROOT, p), 'utf-8')
      expect(/from '@\/services\/ai|from '@\/lib\/ai/.test(src), p).toBe(false)
    }
  })
})
