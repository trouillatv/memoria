// V5.1 Slice 5 — Test doctrinal : wording verrouillé Atelier mémoire.
//
// Doctrine Vincent 2026-05-14 : l'IA peut SÉLECTIONNER dans ce que les humains
// ont déposé, jamais ajouter un mot. 3 verbes autorisés en surface : voici /
// fait écho-se ressemblent / persiste-cesse.
//
// Ce test parcourt les fichiers IA-curatifs (lib/ai/, app/(dashboard)/memoire/)
// et FAIL si un mot interdit (jugement de valeur, injonction, dramatisation,
// métrique exposée) apparaît dans des string literals.
//
// Si tu lis ce commentaire parce que le test vient de planter : le mot
// interdit que tu as ajouté ressemble à une dérive jugement. Reformule en
// registre descriptif strict.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { FORBIDDEN_AI_WORDS } from '@/lib/ai/forbidden-words'

const REPO_ROOT = join(__dirname, '..', '..')

const SCAN_DIRS = [
  join(REPO_ROOT, 'lib', 'ai'),
  join(REPO_ROOT, 'app', '(dashboard)', 'memoire'),
] as const

// Fichiers exempts du scan : la liste elle-même contient les mots interdits.
const EXEMPT_FILES = new Set([
  join(REPO_ROOT, 'lib', 'ai', 'forbidden-words.ts'),
])

function walk(dir: string): string[] {
  let out: string[] = []
  try {
    const entries = readdirSync(dir)
    for (const e of entries) {
      const full = join(dir, e)
      const st = statSync(full)
      if (st.isDirectory()) {
        out = out.concat(walk(full))
      } else if (st.isFile() && /\.(ts|tsx)$/.test(e)) {
        out.push(full)
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return out
}

describe('FORBIDDEN_AI_WORDS — surface IA-curative', () => {
  it("aucun fichier de lib/ai/ ou app/(dashboard)/memoire/ ne contient un mot interdit en string literal", () => {
    const allFiles = SCAN_DIRS.flatMap(walk).filter((f) => !EXEMPT_FILES.has(f))
    const violations: Array<{ file: string; word: string; line: number; lineText: string }> = []

    for (const file of allFiles) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Skip commentaires (// ou ligne dans /* */)
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

        // Match dans les string literals (entre quotes/backticks)
        // Approximation : on cherche les mots interdits dans toute la ligne
        // si elle contient une quote — réduit les faux positifs sur les
        // identifiants TypeScript.
        if (!/['"`]/.test(line)) continue

        const lower = line.toLowerCase()
        for (const word of FORBIDDEN_AI_WORDS) {
          // Match strict avec word boundary
          const pattern = new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`)
          if (pattern.test(lower)) {
            violations.push({
              file: relative(REPO_ROOT, file),
              word,
              line: i + 1,
              lineText: line.trim().slice(0, 120),
            })
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line} → "${v.word}"\n    ${v.lineText}`)
        .join('\n')
      throw new Error(
        `[Doctrine V5.1] Mot(s) interdit(s) détecté(s) dans la surface IA-curative :\n${msg}\n` +
        `Cf. lib/ai/forbidden-words.ts pour la liste complète. Reformule en registre descriptif strict.`
      )
    }

    expect(violations).toHaveLength(0)
  })

  it('FORBIDDEN_AI_WORDS contient au moins jugement, injonction, métrique, dramatisation', () => {
    expect(FORBIDDEN_AI_WORDS).toContain('important')
    expect(FORBIDDEN_AI_WORDS).toContain('il faudrait')
    expect(FORBIDDEN_AI_WORDS).toContain('score')
    expect(FORBIDDEN_AI_WORDS).toContain('bravo')
  })
})
